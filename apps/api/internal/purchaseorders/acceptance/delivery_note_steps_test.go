package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// PO routes with the document templates mounted.
func (s *scenarioState) deliveryNoteServer() *httptest.Server {
	if s.dnSrv != nil {
		return s.dnSrv
	}
	_, here, _, _ := runtime.Caller(0)
	d := deps.Deps{
		Pool:          testutil.Pool(s.t),
		Queries:       testutil.Store(s.t),
		TemplatesRoot: filepath.Join(filepath.Dir(here), "..", "..", "..", "templates", "documents"),
		Pdf:           deps.PdfSettings{SignerName: "Bryan"},
	}
	uid := s.userID
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserID(req.Context(), uid)))
		})
	})
	r.Mount("/purchase-orders", purchaseorders.Routes(d))
	s.dnSrv = httptest.NewServer(r)
	s.t.Cleanup(s.dnSrv.Close)
	return s.dnSrv
}

func (s *scenarioState) downloadDeliveryNote() error {
	srv := s.deliveryNoteServer()
	res, err := srv.Client().Get(srv.URL + "/purchase-orders/" + strconv.FormatInt(s.poID, 10) + "/delivery-note.pdf")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(res.Body); err != nil {
		return err
	}
	s.last = res
	s.body = buf.Bytes()
	return nil
}

func (s *scenarioState) readDeliveryNoteNumber() (string, error) {
	var po struct {
		DeliveryNoteNumber *string `json:"deliveryNoteNumber"`
	}
	if err := json.Unmarshal(s.body, &po); err != nil {
		return "", err
	}
	if po.DeliveryNoteNumber == nil || !strings.HasPrefix(*po.DeliveryNoteNumber, "DN-") {
		return "", fmt.Errorf("no delivery note number issued: %s", s.body)
	}
	return *po.DeliveryNoteNumber, nil
}

func (s *scenarioState) poHasDeliveryNoteNumber() error {
	dn, err := s.readDeliveryNoteNumber()
	if err != nil {
		return err
	}
	s.dnNumber = dn
	return nil
}

// A revert and re-promotion must not consume a second number.
func (s *scenarioState) deliveryNoteNumberUnchanged() error {
	dn, err := s.readDeliveryNoteNumber()
	if err != nil {
		return err
	}
	if dn != s.dnNumber {
		return fmt.Errorf("delivery note number changed from %s to %s", s.dnNumber, dn)
	}
	return nil
}

func (s *scenarioState) exportPOList() error {
	return s.sendRequest(http.MethodGet, "/purchase-orders/export.xlsx", nil)
}

func (s *scenarioState) exportListsDeliveryNoteNumber() error {
	f, err := excelize.OpenReader(bytes.NewReader(s.body))
	if err != nil {
		return err
	}
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetName(0))
	if err != nil {
		return err
	}
	for _, row := range rows {
		if len(row) > 0 && row[0] == s.dnNumber {
			return nil
		}
	}
	return fmt.Errorf("export does not list %s: %v", s.dnNumber, rows)
}

// Status column shows the label.
func (s *scenarioState) exportShowsStatusLabel(want string) error {
	f, err := excelize.OpenReader(bytes.NewReader(s.body))
	if err != nil {
		return err
	}
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetName(0))
	if err != nil {
		return err
	}
	const statusCol = 5
	for _, row := range rows[1:] {
		if len(row) > statusCol && row[statusCol] == want {
			return nil
		}
	}
	return fmt.Errorf("export has no status %q: %v", want, rows)
}

func (s *scenarioState) acceptedQuotationOffering(itemID int64, requested string) error {
	impa := "999999"
	return s.acceptedQuotationWith(defaultCompany, quotations.CreateItem{
		RequestedName: requested,
		RequestedImpa: &impa,
		OfferedItemID: &itemID,
		Qty:           "2",
		UnitID:        defaultUnit,
		SellingPrice:  "100000",
	})
}

// Documents print the offered item, not the request text.
func (s *scenarioState) firstLineNamedAfterItem(itemID int64) error {
	var want string
	if err := testutil.Pool(s.t).QueryRow(context.Background(),
		`SELECT name FROM items WHERE id = $1`, itemID).Scan(&want); err != nil {
		return err
	}
	var rows []purchaseorders.PurchaseOrderItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("PO has no lines")
	}
	if rows[0].ItemName != want {
		return fmt.Errorf("want line named %q got %q", want, rows[0].ItemName)
	}
	return nil
}

// Guards the fixture the next steps rely on.
func (s *scenarioState) catalogItemHasNoCode(itemID int64) error {
	var code *string
	if err := testutil.Pool(s.t).QueryRow(context.Background(),
		`SELECT NULLIF(impa_code, '') FROM items WHERE id = $1`, itemID).Scan(&code); err != nil {
		return err
	}
	if code != nil {
		return fmt.Errorf("catalog item %d has IMPA code %q", itemID, *code)
	}
	return nil
}

// A matched line never borrows the requested code.
func (s *scenarioState) firstLineHasNoCode() error {
	var rows []purchaseorders.PurchaseOrderItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("PO has no lines")
	}
	if rows[0].ItemCode != nil {
		return fmt.Errorf("want no item code got %q", *rows[0].ItemCode)
	}
	return nil
}
