package acceptance_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A PO with two destinations.
// The shipping line goes to address and the second product line to dest.
func (s *scenarioState) acceptedQuotationShippingTo(address, dest string) error {
	return s.acceptedQuotationFrom(quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: defaultCompany,
		DiscountPct:     "0",
		ShippingAddress: &address,
		Items: []quotations.CreateItem{
			{RequestedName: "Tali Tambang Nilon", Qty: "2", UnitID: defaultUnit, SellingPrice: "100000"},
			{RequestedName: "Cat Kapal Merah", Qty: "1", UnitID: defaultUnit, SellingPrice: "50000", ShipDestination: &dest},
		},
	})
}

// productLine reads the nth product line.
// It reads the items fresh, so s.last holds the items read.
func (s *scenarioState) productLine(n int) (purchaseorders.PurchaseOrderItem, error) {
	if err := s.listPOItems(); err != nil {
		return purchaseorders.PurchaseOrderItem{}, err
	}
	var rows []purchaseorders.PurchaseOrderItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return purchaseorders.PurchaseOrderItem{}, err
	}
	seen := 0
	for _, r := range rows {
		if r.ItemType != "product" {
			continue
		}
		if seen++; seen == n {
			return r, nil
		}
	}
	return purchaseorders.PurchaseOrderItem{}, fmt.Errorf("PO has no product line %d: %s", n, s.body)
}

func (s *scenarioState) lineStartsWithNote(n int, want string) error {
	line, err := s.productLine(n)
	if err != nil {
		return err
	}
	if line.DnNoteDefault != want {
		return fmt.Errorf("line %d starts with %q, want %q", n, line.DnNoteDefault, want)
	}
	return nil
}

func (s *scenarioState) lineStartsWithNoNote(n int) error {
	return s.lineStartsWithNote(n, "")
}

func (s *scenarioState) lineHasNote(n int, want string) error {
	line, err := s.productLine(n)
	if err != nil {
		return err
	}
	if line.DnNote == nil || *line.DnNote != want {
		return fmt.Errorf("line %d has note %v, want %q", n, line.DnNote, want)
	}
	return nil
}

// noteBody names one product line.
func (s *scenarioState) noteBody(n int, note string) (purchaseorders.UpdateDeliveryNoteRequest, error) {
	line, err := s.productLine(n)
	if err != nil {
		return purchaseorders.UpdateDeliveryNoteRequest{}, err
	}
	return purchaseorders.UpdateDeliveryNoteRequest{
		Notes: []purchaseorders.DeliveryNoteLineNote{{LineID: line.ID, Note: note}},
	}, nil
}

func (s *scenarioState) saveNote(note string, n int) error {
	body, err := s.noteBody(n, note)
	if err != nil {
		return err
	}
	version, err := s.currentVersion()
	if err != nil {
		return err
	}
	return s.sendRequestWithHeaders(http.MethodPatch, s.poPath("/delivery-note"), body,
		map[string]string{"If-Match": version})
}

func (s *scenarioState) saveNoteStale(n int) error {
	body, err := s.noteBody(n, "Serahkan ke mualim")
	if err != nil {
		return err
	}
	return s.sendRequestWithHeaders(http.MethodPatch, s.poPath("/delivery-note"), body,
		map[string]string{"If-Match": "999"})
}

// The role refusal comes first.
// The mount refuses before the body or the version is read.
func (s *scenarioState) roleUserSavesNote(n int) error {
	body, err := s.noteBody(n, "Serahkan ke mualim")
	if err != nil {
		return err
	}
	return s.sendAsRole(http.MethodPatch, "/api/v1"+s.poPath("/delivery-note"), body)
}

// deliveryNoteText reads the downloaded PDF.
// It skips without xelatex or pdftotext.
func (s *scenarioState) deliveryNoteText() (string, error) {
	for _, bin := range []string{"xelatex", "pdftotext"} {
		if _, err := exec.LookPath(bin); err != nil {
			return "", godog.ErrSkip
		}
	}
	if s.last.StatusCode != http.StatusOK {
		return "", fmt.Errorf("delivery note want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	dir, err := os.MkdirTemp("", "dn")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "note.pdf")
	if err := os.WriteFile(path, s.body, 0o600); err != nil {
		return "", err
	}
	out, err := exec.Command("pdftotext", "-layout", path, "-").Output()
	return string(out), err
}

func (s *scenarioState) deliveryNotePrintsAddressOnce(addr string) error {
	text, err := s.deliveryNoteText()
	if err != nil {
		return err
	}
	if !regexp.MustCompile(`Address\s*:\s*` + regexp.QuoteMeta(addr)).MatchString(text) {
		return fmt.Errorf("the Address is not %q:\n%s", addr, text)
	}
	if n := strings.Count(text, addr); n != 1 {
		return fmt.Errorf("%q prints %d times, want once:\n%s", addr, n, text)
	}
	return nil
}

func (s *scenarioState) deliveryNotePrints(want string) error {
	text, err := s.deliveryNoteText()
	if err != nil {
		return err
	}
	if !strings.Contains(text, want) {
		return fmt.Errorf("the delivery note does not print %q:\n%s", want, text)
	}
	return nil
}

func (s *scenarioState) deliveryNotePrintsOnce(want string) error {
	text, err := s.deliveryNoteText()
	if err != nil {
		return err
	}
	if n := strings.Count(text, want); n != 1 {
		return fmt.Errorf("%q prints %d times, want once:\n%s", want, n, text)
	}
	return nil
}

func registerDeliveryNoteSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^an accepted quotation shipping to "([^"]+)" with a second line going to "([^"]+)"$`, s.acceptedQuotationShippingTo)
	sc.Step(`^product line (\d+) starts with no note$`, s.lineStartsWithNoNote)
	sc.Step(`^product line (\d+) starts with the note "([^"]+)"$`, s.lineStartsWithNote)
	sc.Step(`^product line (\d+) has the note "([^"]+)"$`, s.lineHasNote)
	sc.Step(`^the user saves the note "([^"]+)" on product line (\d+)$`, s.saveNote)
	sc.Step(`^the user saves a note on product line (\d+) with a stale If-Match$`, s.saveNoteStale)
	sc.Step(`^that user saves a note on product line (\d+)$`, s.roleUserSavesNote)
	sc.Step(`^the delivery note prints the Address "([^"]+)" once$`, s.deliveryNotePrintsAddressOnce)
	sc.Step(`^the delivery note prints "([^"]+)" once$`, s.deliveryNotePrintsOnce)
	sc.Step(`^the delivery note prints "([^"]+)"$`, s.deliveryNotePrints)
}
