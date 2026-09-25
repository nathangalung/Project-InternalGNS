package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// catalogItem is a seed item.
const catalogItem int64 = 1

// readinessFixture tracks addressless master data.
// The quotation chooses the second contact; the first stays active so the
// scenarios can tell the chosen one from the fallback.
type readinessFixture struct {
	clientID     int64
	vendorID     int64
	firstContact int64
	chosen       int64
}

// Quote with blank addresses.
// The client has no address, the vendor no location and the line no
// shipping address, which the quotation accepts.
func (s *scenarioState) acceptedQuotationWithoutAddresses() error {
	ctx := context.Background()
	pool := testutil.Pool(s.t)
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	f := &readinessFixture{}

	if err := pool.QueryRow(ctx, `
		INSERT INTO company_client (number, name, npwp, country_code, created_by, updated_by)
		SELECT lpad(n::text, 4, '0'), $1, '0612345678901000', 'IDN', $2, $2
		FROM generate_series(1000, 9999) n
		WHERE NOT EXISTS (SELECT 1 FROM company_client WHERE number = lpad(n::text, 4, '0'))
		LIMIT 1
		RETURNING id`, "PT Siap Kerja "+tag, s.userID).Scan(&f.clientID); err != nil {
		return fmt.Errorf("insert client: %w", err)
	}
	s.cleaner.Client(f.clientID)
	// Its document counters RESTRICT the client delete. Registered after
	// the cleaner, so this runs first.
	clientID := f.clientID
	s.t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM doc_sequences WHERE company_id = $1`, clientID); err != nil {
			s.t.Errorf("drop doc sequences of client %d: %v", clientID, err)
		}
	})
	for i, id := range []*int64{&f.firstContact, &f.chosen} {
		if err := pool.QueryRow(ctx, `
			INSERT INTO company_contacts (company_id, name, email, country_code, created_by, updated_by)
			VALUES ($1, $2, $3, 'IDN', $4, $4)
			RETURNING id`, f.clientID, fmt.Sprintf("Narahubung %d", i+1),
			fmt.Sprintf("kontak%d.%s@gns.test", i+1, tag), s.userID).Scan(id); err != nil {
			return fmt.Errorf("insert contact: %w", err)
		}
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO vendors (name, contact_info, created_by, updated_by)
		VALUES ($1, jsonb_build_object('email', $2::text), $3, $3)
		RETURNING id`, "CV Tanpa Lokasi "+tag, "cv."+tag+"@gns.test", s.userID).Scan(&f.vendorID); err != nil {
		return fmt.Errorf("insert vendor: %w", err)
	}
	s.cleaner.Vendor(f.vendorID)
	var vendorProductID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 50000, $3, $3)
		RETURNING id`, f.vendorID, catalogItem, s.userID).Scan(&vendorProductID); err != nil {
		return fmt.Errorf("insert vendor product: %w", err)
	}

	s.gate = f
	offered, cost := catalogItem, "50000"
	return s.acceptedQuotationFrom(quotations.CreateRequest{
		CompanyClientID: f.clientID,
		ContactID:       &f.chosen,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Tali Tambang", OfferedItemID: &offered, VendorProductID: &vendorProductID,
			Qty: "2", UnitID: defaultUnit, SellingPrice: "100000", CostPrice: &cost,
		}},
	})
}

// execFixture runs one fixture write.
func (s *scenarioState) execFixture(sql string, args ...any) error {
	_, err := testutil.Pool(s.t).Exec(context.Background(), sql, args...)
	return err
}

func (s *scenarioState) fillClientAddress() error {
	return s.execFixture(`UPDATE company_client SET address = 'Jl. Pelabuhan No. 1, Jakarta Utara' WHERE id = $1`,
		s.gate.clientID)
}

func (s *scenarioState) fillVendorLocation() error {
	return s.execFixture(`UPDATE vendors SET location = 'Surabaya' WHERE id = $1`, s.gate.vendorID)
}

// Mirrors clients.deactivate_contact.
func (s *scenarioState) deactivateChosenContact() error {
	return s.execFixture(`UPDATE company_contacts SET is_active = FALSE WHERE id = $1`, s.gate.chosen)
}

func (s *scenarioState) chooseOtherContact() error {
	path := "/quotations/" + strconv.FormatInt(s.quotationID, 10) + "/contact"
	if err := s.sendRequest(http.MethodPatch, path, map[string]int64{"contactId": s.gate.firstContact}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("choose contact want 204 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

// Address the PO via API.
// Each line keeps its quotation link, so its vendor still reaches the gate;
// the address goes on the shipping line, as the PO editor sends it.
func (s *scenarioState) fillShippingAddress() error {
	poPath := "/purchase-orders/" + strconv.FormatInt(s.poID, 10)
	if err := s.sendRequest(http.MethodGet, poPath+"/items", nil); err != nil {
		return err
	}
	var items []purchaseorders.PurchaseOrderItem
	if err := json.Unmarshal(s.body, &items); err != nil {
		return fmt.Errorf("decode items: %w body=%s", err, s.body)
	}
	if err := s.sendRequest(http.MethodGet, poPath, nil); err != nil {
		return err
	}
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	edit := purchaseorders.UpdateItemsRequest{DiscountPct: "0", ShippingAddress: &testShipDestination}
	for _, it := range items {
		available := it.IsAvailable
		edit.Items = append(edit.Items, purchaseorders.UpdateItemsLine{
			QuotationItemID: it.QuotationItemID, OfferedItemID: it.OfferedItemID,
			ItemName: it.ItemName, ItemCode: it.ItemCode, Qty: it.Qty, UnitID: it.UnitID,
			SellingPrice: it.SellingPrice, CostPrice: it.CostPrice, IsAvailable: &available,
		})
	}
	if err := s.sendRequestWithHeaders(http.MethodPut, poPath+"/items", edit,
		map[string]string{"If-Match": strconv.FormatInt(int64(po.RowVersion), 10)}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusOK {
		return fmt.Errorf("edit items want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) fillEveryAddress() error {
	for _, fill := range []func() error{s.fillClientAddress, s.fillVendorLocation, s.fillShippingAddress} {
		if err := fill(); err != nil {
			return err
		}
	}
	return nil
}

// Gate lists exactly the table.
// Rows are "klien", "vendor" or "pengiriman" against text the message carries.
func (s *scenarioState) gateListsExactly(table *godog.Table) error {
	if s.last.StatusCode != http.StatusUnprocessableEntity {
		return fmt.Errorf("want 422 got %d body=%s", s.last.StatusCode, s.body)
	}
	var problem struct {
		Fields map[string]string `json:"fields"`
	}
	if err := json.Unmarshal(s.body, &problem); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, s.body)
	}
	want := make(map[string]string, len(table.Rows))
	for _, row := range table.Rows {
		key, err := s.gateKey(row.Cells[0].Value)
		if err != nil {
			return err
		}
		want[key] = row.Cells[1].Value
	}
	if got, exp := sortedKeys(problem.Fields), sortedKeys(want); strings.Join(got, ",") != strings.Join(exp, ",") {
		return fmt.Errorf("want gaps %v got %v", exp, problem.Fields)
	}
	for key, text := range want {
		if !strings.Contains(problem.Fields[key], text) {
			return fmt.Errorf("want %s to mention %q got %q", key, text, problem.Fields[key])
		}
	}
	return nil
}

// gateKey resolves a table label.
func (s *scenarioState) gateKey(label string) (string, error) {
	switch label {
	case "klien":
		return "klien:" + strconv.FormatInt(s.gate.clientID, 10), nil
	case "vendor":
		return "vendor:" + strconv.FormatInt(s.gate.vendorID, 10), nil
	case "pengiriman":
		return "pengiriman:" + strconv.FormatInt(s.poID, 10), nil
	}
	return "", fmt.Errorf("unknown gap label %q", label)
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func registerReadinessSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^an accepted quotation for a new client and vendor without addresses$`, s.acceptedQuotationWithoutAddresses)
	sc.Step(`^the user fills the client address$`, s.fillClientAddress)
	sc.Step(`^the user fills the vendor location$`, s.fillVendorLocation)
	sc.Step(`^the user fills the PO shipping address$`, s.fillShippingAddress)
	sc.Step(`^every address is filled$`, s.fillEveryAddress)
	sc.Step(`^the quotation's chosen contact is deactivated$`, s.deactivateChosenContact)
	sc.Step(`^the user chooses the client's other contact on the quotation$`, s.chooseOtherContact)
	sc.Step(`^the gate lists exactly these gaps:$`, s.gateListsExactly)
}
