package acceptance_test

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/cucumber/godog"
	"github.com/shopspring/decimal"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// coretaxLine is one filed GoodService.
type coretaxLine struct {
	Price         string `xml:"Price"`
	Qty           string `xml:"Qty"`
	TotalDiscount string `xml:"TotalDiscount"`
	TaxBase       string `xml:"TaxBase"`
}

// deliveredDiscountedPurchaseOrder invoices a discounted line.
func (s *scenarioState) deliveredDiscountedPurchaseOrder(qty, price, discountPct string) error {
	return s.deliverQuotation(quotations.CreateRequest{
		CompanyClientID: defaultCompany,
		DiscountPct:     discountPct,
		Items: []quotations.CreateItem{{
			RequestedName: "Discounted Product",
			Qty:           qty,
			UnitID:        defaultUnit,
			SellingPrice:  price,
		}},
	})
}

// exportCoretax fetches the invoice XML.
func (s *scenarioState) exportCoretax() error {
	srv := s.coretaxServer()
	res, err := srv.Client().Get(srv.URL + "/invoices/" + strconv.FormatInt(s.invoiceID, 10) + "/coretax.xml")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	s.last, s.body = res, raw
	return nil
}

func (s *scenarioState) coretaxLines() ([]coretaxLine, error) {
	var doc struct {
		Lines []coretaxLine `xml:"ListOfTaxInvoice>TaxInvoice>ListOfGoodService>GoodService"`
	}
	if err := xml.Unmarshal(s.body, &doc); err != nil {
		return nil, fmt.Errorf("coretax xml: %w body=%s", err, s.body)
	}
	if len(doc.Lines) == 0 {
		return nil, fmt.Errorf("coretax xml has no lines")
	}
	return doc.Lines, nil
}

// everyCoretaxLineBalances checks DJP's per-line rule.
func (s *scenarioState) everyCoretaxLineBalances() error {
	lines, err := s.coretaxLines()
	if err != nil {
		return err
	}
	for i, l := range lines {
		filed := dec(l.Price).Mul(dec(l.Qty)).Sub(dec(l.TotalDiscount))
		if !filed.Equal(dec(l.TaxBase)) {
			return fmt.Errorf("line %d: %s x %s - %s = %s, want TaxBase %s",
				i+1, l.Price, l.Qty, l.TotalDiscount, filed, l.TaxBase)
		}
	}
	return nil
}

// coretaxLinesMatchInvoice reconciles the header.
func (s *scenarioState) coretaxLinesMatchInvoice() error {
	lines, err := s.coretaxLines()
	if err != nil {
		return err
	}
	base, disc := decimal.Zero, decimal.Zero
	for _, l := range lines {
		base = base.Add(dec(l.TaxBase))
		disc = disc.Add(dec(l.TotalDiscount))
	}
	if err := s.readInvoiceByID(); err != nil {
		return err
	}
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	if inv.Dpp == nil || inv.TotalDiscount == nil {
		return fmt.Errorf("invoice lacks dpp or total discount body=%s", s.body)
	}
	if !base.Equal(dec(*inv.Dpp)) || !disc.Equal(dec(*inv.TotalDiscount)) {
		return fmt.Errorf("lines sum to DPP %s discount %s, invoice has DPP %s discount %s",
			base, disc, *inv.Dpp, *inv.TotalDiscount)
	}
	return nil
}

func dec(s string) decimal.Decimal {
	d, err := decimal.NewFromString(strings.TrimSpace(s))
	if err != nil {
		return decimal.Zero
	}
	return d
}

// callOnInvoice requests an invoice path.
// {id} stands for the scenario invoice.
func (s *scenarioState) callOnInvoice(method, path string) error {
	path = strings.ReplaceAll(path, "{id}", strconv.FormatInt(s.invoiceID, 10))
	var body any
	switch {
	case strings.HasSuffix(path, "/dates"):
		body = map[string]string{"dueDate": "2031-12-31T00:00:00+07:00"}
		return s.sendRequestWithHeaders(method, path, body, map[string]string{"If-Match": "1"})
	case strings.HasSuffix(path, "/attachment"):
		body = map[string]string{"objectKey": "invoices/" + strconv.FormatInt(s.invoiceID, 10) + "/1-a.pdf"}
	}
	return s.sendRequest(method, path, body)
}

// listByEffectiveStatus filters like tiles.
func (s *scenarioState) listByEffectiveStatus(status string) error {
	return s.sendRequest(http.MethodGet, "/invoices/?effectiveStatus="+status, nil)
}

// invoiceListIsTheInvoice expects exactly this invoice.
func (s *scenarioState) invoiceListIsTheInvoice() error {
	var rows []invoices.Invoice
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) != 1 || rows[0].ID != s.invoiceID {
		ids := make([]int64, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.ID)
		}
		return fmt.Errorf("want only invoice %d got %v", s.invoiceID, ids)
	}
	return nil
}

// invoiceListIsEmpty expects no rows.
func (s *scenarioState) invoiceListIsEmpty() error {
	if s.last.StatusCode != http.StatusOK {
		return fmt.Errorf("list want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	var rows []invoices.Invoice
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) != 0 {
		return fmt.Errorf("want no invoices got %d", len(rows))
	}
	return nil
}

// updateDueDateStale sends a spent version.
func (s *scenarioState) updateDueDateStale(date string) error {
	if err := s.readInvoiceByID(); err != nil {
		return err
	}
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	return s.sendRequestWithHeaders(http.MethodPatch,
		"/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/dates",
		map[string]string{"dueDate": date + "T00:00:00+07:00"},
		map[string]string{"If-Match": strconv.FormatInt(int64(inv.RowVersion-1), 10)},
	)
}

func (s *scenarioState) registerFilingSteps(sc *godog.ScenarioContext) {
	sc.Step(`^the user updates invoice due date to "([^"]+)" with a stale version$`, s.updateDueDateStale)
	sc.Step(`^a delivered purchase order of (\d+) units at ([\d.]+) with a (\d+) percent discount$`, s.deliveredDiscountedPurchaseOrder)
	sc.Step(`^the user exports the invoice to Coretax$`, s.exportCoretax)
	sc.Step(`^every Coretax line balances$`, s.everyCoretaxLineBalances)
	sc.Step(`^the Coretax lines sum to the invoice DPP and discount$`, s.coretaxLinesMatchInvoice)
	sc.Step(`^the user calls (GET|PATCH|POST) "([^"]+)"$`, s.callOnInvoice)
	sc.Step(`^the user lists invoices with effective status "([a-z]+)"$`, s.listByEffectiveStatus)
	sc.Step(`^the invoice list is exactly the invoice$`, s.invoiceListIsTheInvoice)
	sc.Step(`^the invoice list is empty$`, s.invoiceListIsEmpty)
}
