package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Delivery fixture notes.
const fixtureNotes = "Kirim pagi"

func idPath(id int64, suffix string) string {
	return "/quotations/" + strconv.FormatInt(id, 10) + suffix
}

// deliveryLine is the fixture product.
func deliveryLine() []quotations.CreateItem {
	return []quotations.CreateItem{offeredLine("ITEM 1", "1", "10000")}
}

func (s *scenarioState) createForVessel(vessel string, days int) error {
	cost, addr, notes := "50000", "Tanjung Priok", fixtureNotes
	req := s.buildCreate("0", 1)
	req.VesselName, req.Notes = &vessel, &notes
	req.ShippingCost, req.ShippingAddress, req.ShippingDays = &cost, &addr, &days
	if err := s.sendRequest(http.MethodPost, "/quotations/", req); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("create want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return s.responseHasID()
}

func (s *scenarioState) pdfPrints(want string) error {
	out, err := exec.Command("pdftotext", "-layout", s.pdfPath, "-").Output()
	if err != nil {
		return fmt.Errorf("pdftotext: %w", err)
	}
	text := strings.Join(strings.Fields(string(out)), " ")
	if !strings.Contains(text, want) {
		return fmt.Errorf("PDF misses %q in: %s", want, text)
	}
	return nil
}

// editVesselAndNotes sends a full PUT.
func (s *scenarioState) editVesselAndNotes(sending string) error {
	d, err := s.readByID(s.lastID)
	if err != nil {
		return err
	}
	req := quotations.UpdateRequest{
		DiscountPct:     "0",
		ShippingAddress: d.Items[len(d.Items)-1].ShipDestination,
		ShippingDays:    d.Items[len(d.Items)-1].ShippingDays,
		ShippingCost:    &d.Items[len(d.Items)-1].SellingPrice,
		Items:           deliveryLine(),
	}
	if sending == "resending" {
		req.VesselName, req.Notes = d.VesselName, d.Notes
	}
	return s.sendRequestWith(http.MethodPut, idPath(s.lastID, ""), req,
		map[string]string{"If-Match": strconv.Itoa(int(d.RowVersion))})
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s *scenarioState) vesselAndNotesAre(vessel, notes string) error {
	d, err := s.readByID(s.lastID)
	if err != nil {
		return err
	}
	if deref(d.VesselName) != vessel || deref(d.Notes) != notes {
		return fmt.Errorf("vessel %q notes %q, want %q and %q", deref(d.VesselName), deref(d.Notes), vessel, notes)
	}
	return nil
}

func (s *scenarioState) createWithQtyPrice(qty, price string) error {
	req := s.buildCreate("0", 1)
	req.Items[0].Qty, req.Items[0].SellingPrice = qty, price
	return s.sendRequest(http.MethodPost, "/quotations/", req)
}

func (s *scenarioState) actOnUnknown(action string, id int64) error {
	switch action {
	case "sends":
		return s.sendRequest(http.MethodPost, idPath(id, "/send"), nil)
	case "cancels":
		reason := testReason
		return s.sendRequest(http.MethodPatch, idPath(id, "/status"),
			quotations.ChangeStatusRequest{Status: quotations.StatusCancelled, Note: &reason})
	}
	return fmt.Errorf("unknown action %q", action)
}

func (s *scenarioState) listWith(query string) error {
	return s.sendRequest(http.MethodGet, "/quotations/?"+query, nil)
}

func (s *scenarioState) twoDraftsWithRequest() error {
	if err := s.seedDraft(); err != nil {
		return err
	}
	first := s.lastID
	if err := s.seedDraft(); err != nil {
		return err
	}
	s.otherID, s.lastID = s.lastID, first
	if err := s.sendRequest(http.MethodPost, idPath(first, "/requests"),
		quotations.ItemRequestCreate{LineNo: 1, RequestText: "LAMP LED 12W"}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("request want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	var row quotations.ItemRequestRow
	if err := json.Unmarshal(s.body, &row); err != nil {
		return err
	}
	s.requestID = row.ID
	return nil
}

func (s *scenarioState) foreignRequestPath() string {
	return idPath(s.otherID, "/requests/"+strconv.FormatInt(s.requestID, 10))
}

func (s *scenarioState) editRequestViaOther() error {
	return s.sendRequestWith(http.MethodPut, s.foreignRequestPath(), quotations.ItemRequestUpdate{
		LineNo: 1, RequestText: "DIUBAH LEWAT QUOTATION LAIN", MatchStatus: "pending", SourceType: "manual",
	}, map[string]string{"If-Match": "0"})
}

func (s *scenarioState) deleteRequestViaOther() error {
	return s.sendRequest(http.MethodDelete, s.foreignRequestPath(), nil)
}

func (s *scenarioState) requestUnchanged() error {
	if err := s.sendRequest(http.MethodGet, idPath(s.lastID, "/requests"), nil); err != nil {
		return err
	}
	var rows []quotations.ItemRequestRow
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) != 1 || rows[0].RequestText != "LAMP LED 12W" || rows[0].RowVersion != 0 {
		return fmt.Errorf("item requests = %+v, want the untouched original", rows)
	}
	return nil
}

// addContact inserts a scenario contact.
func (s *scenarioState) addContact(company int64, name string) (int64, error) {
	pool := testutil.Pool(s.t)
	ctx := context.Background()
	var id int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, country_code, created_by, updated_by)
		VALUES ($1, $2, 'IDN', 1, 1) RETURNING id`, company, name).Scan(&id); err != nil {
		return 0, err
	}
	// quotations.contact_id is ON DELETE SET NULL.
	s.t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM company_contacts WHERE id = $1`, id) })
	return id, nil
}

func (s *scenarioState) changeContact(sameClient bool) error {
	company, name := int64(2), "Kontak Klien Lain"
	if sameClient {
		company, name = defaultCompany, "Kontak Pengganti"
	}
	id, err := s.addContact(company, name)
	if err != nil {
		return err
	}
	if sameClient {
		s.contactID = id
	}
	return s.sendRequest(http.MethodPatch, idPath(s.lastID, "/contact"),
		quotations.ChangeContactRequest{ContactID: id})
}

func (s *scenarioState) contactIsSet() error {
	d, err := s.readByID(s.lastID)
	if err != nil {
		return err
	}
	if d.ContactID == nil || *d.ContactID != s.contactID {
		return fmt.Errorf("contact %v, want %d", d.ContactID, s.contactID)
	}
	return nil
}

// callPathAs calls a templated path.
func (s *scenarioState) callPathAs(role, method, path string) error {
	path = strings.ReplaceAll(path, "{id}", strconv.FormatInt(s.lastID, 10))
	var body any
	if method != http.MethodGet {
		body = map[string]any{}
	}
	return s.callAs(role, method, path, body)
}

// firstLine reads the first product line.
func (s *scenarioState) firstLine() (quotations.QuotationItem, error) {
	d, err := s.readByID(s.lastID)
	if err != nil {
		return quotations.QuotationItem{}, err
	}
	for _, it := range d.Items {
		if it.ItemType == "product" {
			return it, nil
		}
	}
	return quotations.QuotationItem{}, fmt.Errorf("quotation %d has no product line", s.lastID)
}

// markFirstLine toggles Tidak Ditawarkan.
func (s *scenarioState) markFirstLine(role, move string) error {
	it, err := s.firstLine()
	if err != nil {
		return err
	}
	path := idPath(s.lastID, "/lines/"+strconv.FormatInt(it.ID, 10)+"/offer")
	return s.callAs(role, http.MethodPatch, path,
		quotations.LineOfferRequest{IsAvailable: move == "puts the first line back on offer"})
}

func (s *scenarioState) firstLineIs(state, price string) error {
	it, err := s.firstLine()
	if err != nil {
		return err
	}
	if it.IsAvailable != (state == "offered") || it.SellingPrice != price {
		return fmt.Errorf("first line available %v at %s, want %s at %s",
			it.IsAvailable, it.SellingPrice, state, price)
	}
	return nil
}

func registerEdgeSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^a "([^"]+)" user (marks the first line Tidak Ditawarkan|puts the first line back on offer)$`, s.markFirstLine)
	sc.Step(`^the first line is (offered|not offered) at harga jual "([^"]+)"$`, s.firstLineIs)
	sc.Step(`^a draft quotation for vessel "([^"]+)" shipped in (\d+) days$`, s.createForVessel)
	sc.Step(`^the PDF prints "([^"]+)"$`, s.pdfPrints)
	sc.Step(`^the user edits the quotation (resending|leaving out) vessel and notes$`, s.editVesselAndNotes)
	sc.Step(`^the quotation vessel is "([^"]*)" and its notes are "([^"]*)"$`, s.vesselAndNotesAre)
	sc.Step(`^the user creates a quotation whose line has qty "([^"]+)" and price "([^"]+)"$`, s.createWithQtyPrice)
	sc.Step(`^the user (sends|cancels) quotation (\d+)$`, s.actOnUnknown)
	sc.Step(`^the user lists quotations with "([^"]+)"$`, s.listWith)
	sc.Step(`^two draft quotations and an item request on the first$`, s.twoDraftsWithRequest)
	sc.Step(`^the user edits that request through the second quotation$`, s.editRequestViaOther)
	sc.Step(`^the user deletes that request through the second quotation$`, s.deleteRequestViaOther)
	sc.Step(`^the item request on the first quotation is unchanged$`, s.requestUnchanged)
	sc.Step(`^the user changes the contact to one of another client$`, func() error { return s.changeContact(false) })
	sc.Step(`^the user changes the contact to another contact of the same client$`, func() error { return s.changeContact(true) })
	sc.Step(`^the quotation contact is that contact$`, s.contactIsSet)
	sc.Step(`^a "([^"]+)" user calls (GET|POST|PUT|PATCH) "([^"]+)" through the API$`, s.callPathAs)
}
