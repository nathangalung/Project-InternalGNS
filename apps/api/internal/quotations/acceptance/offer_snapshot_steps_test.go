package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// snapshotState is one renamed product.
type snapshotState struct {
	item             int64
	oldName, oldImpa string
	newName, newImpa string
	sent, draft      int64
}

// createOffering drafts one quotation.
func (s *scenarioState) createOffering(item, link int64) (int64, error) {
	cost := "5000"
	req := s.buildCreate("0", 0)
	req.Items = []quotations.CreateItem{{
		RequestedName: "Permintaan klien", OfferedItemID: &item, VendorProductID: &link,
		Qty: "1", UnitID: defaultUnit, SellingPrice: "10000", CostPrice: &cost,
	}}
	if err := s.sendRequest(http.MethodPost, "/quotations/", req); err != nil {
		return 0, err
	}
	if s.last.StatusCode != http.StatusCreated {
		return 0, fmt.Errorf("create want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	if err := s.responseHasID(); err != nil {
		return 0, err
	}
	s.clean.Quotation(s.lastID)
	return s.lastID, nil
}

func (s *scenarioState) productOnSentAndDraft() error {
	ctx := context.Background()
	pool := testutil.Pool(s.t)
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	s.snap = snapshotState{oldName: "Tali Tambat " + tag, oldImpa: strings.ToUpper("t" + tag[len(tag)-7:])}
	if err := pool.QueryRow(ctx, `
		INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by)
		VALUES ($1, $2, $3, 1, 1) RETURNING id`, s.snap.oldName, s.snap.oldImpa, defaultUnit).Scan(&s.snap.item); err != nil {
		return err
	}
	s.clean.Item(s.snap.item)
	var link int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 5000, 1, 1) RETURNING id`, testutil.SeedVendorID, s.snap.item).Scan(&link); err != nil {
		return err
	}
	var err error
	if s.snap.sent, err = s.createOffering(s.snap.item, link); err != nil {
		return err
	}
	if err := s.sendAction(); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("send want 204 got %d body=%s", s.last.StatusCode, s.body)
	}
	s.snap.draft, err = s.createOffering(s.snap.item, link)
	return err
}

func (s *scenarioState) renameProduct() error {
	s.snap.newName, s.snap.newImpa = "Tali Tambat Nilon "+s.snap.oldImpa, "N"+s.snap.oldImpa[1:]
	unit := defaultUnit
	_, err := items.NewRepo(testutil.Pool(s.t), testutil.Store(s.t)).Update(context.Background(), s.snap.item,
		items.UpdateItemRequest{Name: s.snap.newName, IMPACode: &s.snap.newImpa, DefaultUnitID: &unit, IsActive: true},
		s.userID)
	return err
}

// offerOf reads one detail's offer.
func (s *scenarioState) offerOf(id int64) (string, string, error) {
	s.lastID = id
	if err := s.readDetail(); err != nil {
		return "", "", err
	}
	var d quotations.QuotationDetail
	if err := json.Unmarshal(s.body, &d); err != nil {
		return "", "", err
	}
	for _, it := range d.Items {
		if it.ItemType == "product" && it.OfferedName != nil && it.OfferedImpa != nil {
			return *it.OfferedName, *it.OfferedImpa, nil
		}
	}
	return "", "", fmt.Errorf("quotation %d shows no offered product: %s", id, s.body)
}

// offers compares one detail.
func (s *scenarioState) offers(id int64, name, impa string) error {
	gotName, gotImpa, err := s.offerOf(id)
	if err != nil {
		return err
	}
	if gotName != name || gotImpa != impa {
		return fmt.Errorf("want %q %q got %q %q", name, impa, gotName, gotImpa)
	}
	return nil
}

func (s *scenarioState) sentKeepsOldOffer() error {
	return s.offers(s.snap.sent, s.snap.oldName, s.snap.oldImpa)
}

func (s *scenarioState) draftShowsNewOffer() error {
	return s.offers(s.snap.draft, s.snap.newName, s.snap.newImpa)
}

func (s *scenarioState) sentPDFKeepsOldOffer() error {
	s.lastID = s.snap.sent
	if err := s.downloadPDF(); err != nil {
		return err
	}
	out, err := exec.Command("pdftotext", s.pdfPath, "-").Output()
	if err != nil {
		return fmt.Errorf("pdftotext: %w", err)
	}
	text := strings.Join(strings.Fields(string(out)), " ")
	for _, want := range []string{s.snap.oldName, s.snap.oldImpa} {
		if !strings.Contains(text, want) {
			return fmt.Errorf("PDF misses %q in: %s", want, text)
		}
	}
	for _, gone := range []string{s.snap.newName, s.snap.newImpa} {
		if strings.Contains(text, gone) {
			return fmt.Errorf("PDF prints the renamed %q", gone)
		}
	}
	return nil
}

func (s *scenarioState) acceptSent() error {
	s.lastID = s.snap.sent
	if err := s.transitionTo(string(quotations.StatusAccepted)); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("accept want 204 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) poLineKeepsOldOffer() error {
	ctx := context.Background()
	repo := purchaseorders.NewRepo(testutil.Pool(s.t), testutil.Store(s.t))
	po, err := repo.GetByQuotation(ctx, s.snap.sent)
	if err != nil {
		return err
	}
	lines, err := repo.ListItems(ctx, po.ID)
	if err != nil {
		return err
	}
	for _, l := range lines {
		if l.ItemType != "product" {
			continue
		}
		if l.ItemName != s.snap.oldName || l.ItemCode == nil || *l.ItemCode != s.snap.oldImpa {
			return fmt.Errorf("PO line %q %v, want %q %q", l.ItemName, l.ItemCode, s.snap.oldName, s.snap.oldImpa)
		}
		return nil
	}
	return fmt.Errorf("PO %d has no product line", po.ID)
}

func registerOfferSnapshotSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^a catalog product offered on a sent quotation and on a draft$`, s.productOnSentAndDraft)
	sc.Step(`^the product is renamed and given a new IMPA code$`, s.renameProduct)
	sc.Step(`^the sent quotation still offers the old name and code$`, s.sentKeepsOldOffer)
	sc.Step(`^the draft offers the new name and code$`, s.draftShowsNewOffer)
	sc.Step(`^the sent quotation PDF prints the old name and code$`, s.sentPDFKeepsOldOffer)
	sc.Step(`^the user accepts the sent quotation$`, s.acceptSent)
	sc.Step(`^its purchase order line carries the old name and code$`, s.poLineKeepsOldOffer)
}
