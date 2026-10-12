package acceptance_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// IMPA code rule steps.
// A coded row resolves by its exact code only; the rest keep name matching.

// importRows posts rows to match-rows.
func (s *scenarioState) importRows(autoCreate bool, rows ...items.MatchRowInput) error {
	if err := s.sendRequest(http.MethodPost, "/items/match-rows",
		items.MatchRowsRequest{AutoCreate: autoCreate, Rows: rows}); err != nil {
		return err
	}
	s.trackAutoCreated()
	return nil
}

// importNewCodeByName names the item, codes another.
func (s *scenarioState) importNewCodeByName(autoCreate bool) error {
	s.newImpa = testutil.UniqueIMPA(s.t)
	return s.importRows(autoCreate, items.MatchRowInput{IMPACode: s.newImpa, Name: s.name, Qty: 1})
}

// importedRow reads the one row.
func (s *scenarioState) importedRow() (items.MatchRowResult, error) {
	var out items.MatchRowsResponse
	if err := json.Unmarshal(s.body, &out); err != nil {
		return items.MatchRowResult{}, err
	}
	if len(out.Rows) != 1 {
		return items.MatchRowResult{}, fmt.Errorf("want one row body=%s", s.body)
	}
	return out.Rows[0], nil
}

func (s *scenarioState) rowCreatedUnderNewCode() error {
	row, err := s.importedRow()
	if err != nil {
		return err
	}
	if row.Source != "CREATED" || row.Matched == nil || row.Matched.ItemID == s.itemID {
		return fmt.Errorf("want a new product, not item %d body=%s", s.itemID, s.body)
	}
	if row.Matched.IMPACode == nil || *row.Matched.IMPACode != s.newImpa {
		return fmt.Errorf("want code %s body=%s", s.newImpa, s.body)
	}
	return nil
}

func (s *scenarioState) rowUnmatched() error {
	row, err := s.importedRow()
	if err != nil {
		return err
	}
	if row.Matched != nil || row.Source != "NONE" {
		return fmt.Errorf("want no match body=%s", s.body)
	}
	return nil
}

func (s *scenarioState) rowMatchedByName() error {
	row, err := s.importedRow()
	if err != nil {
		return err
	}
	if row.Matched == nil || row.Matched.ItemID != s.itemID || row.Source == "IMPA_EXACT" {
		return fmt.Errorf("want a name match on item %d body=%s", s.itemID, s.body)
	}
	return nil
}

func (s *scenarioState) importCodeInText() error {
	return s.importRows(false, items.MatchRowInput{Name: "Permintaan klien IMPA " + s.impa, Qty: 1})
}

func (s *scenarioState) requestTextWithoutCode() error {
	row, err := s.importedRow()
	if err != nil {
		return err
	}
	if row.Requested.Name != "Permintaan klien" || row.Requested.IMPACode != s.impa {
		return fmt.Errorf("want the code moved out of the text body=%s", s.body)
	}
	return nil
}

func (s *scenarioState) importBadCode(code string) error {
	return s.importRows(false, items.MatchRowInput{IMPACode: code, Name: s.uniqueName("ATDD BAD"), Qty: 1})
}

func (s *scenarioState) createWithCode(code string) error {
	s.name = s.uniqueName("ATDD CODE")
	if err := s.sendRequest(http.MethodPost, "/items/", items.CreateItemRequest{Name: s.name, IMPACode: &code}); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

func (s *scenarioState) createNameRepeatingCode() error {
	s.impa = testutil.UniqueIMPA(s.t)
	s.name = s.uniqueName("ATDD ULANG")
	name := s.name + " (IMPA " + s.impa + ")"
	if err := s.sendRequest(http.MethodPost, "/items/", items.CreateItemRequest{Name: name, IMPACode: &s.impa}); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

// storedItem reads the saved item.
func (s *scenarioState) storedItem() (items.Item, error) {
	var it items.Item
	if err := json.Unmarshal(s.body, &it); err != nil {
		return it, err
	}
	return it, nil
}

func (s *scenarioState) storedNameWithoutCode() error {
	it, err := s.storedItem()
	if err != nil {
		return err
	}
	if it.Name != s.name || strings.Contains(it.Name, s.impa) {
		return fmt.Errorf("want name %q body=%s", s.name, s.body)
	}
	return nil
}

func (s *scenarioState) storedWithoutCode() error {
	it, err := s.storedItem()
	if err != nil {
		return err
	}
	if it.IMPACode != nil {
		return fmt.Errorf("want no code body=%s", s.body)
	}
	return nil
}

// registerIMPASteps binds the IMPA steps.
func registerIMPASteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^the user imports a row with a new IMPA code and the item's name with auto-create$`,
		func() error { return s.importNewCodeByName(true) })
	sc.Step(`^the user imports a row with a new IMPA code and the item's name$`,
		func() error { return s.importNewCodeByName(false) })
	sc.Step(`^the imported row is a new product holding the new code$`, s.rowCreatedUnderNewCode)
	sc.Step(`^the imported row is unmatched$`, s.rowUnmatched)
	sc.Step(`^the user imports a row with the item's name and no code$`,
		func() error { return s.importRows(false, items.MatchRowInput{Name: s.name, Qty: 1}) })
	sc.Step(`^the imported row matched the seeded item by name$`, s.rowMatchedByName)
	sc.Step(`^the user imports a row whose text names the item's IMPA code$`, s.importCodeInText)
	sc.Step(`^the imported request text no longer names the code$`, s.requestTextWithoutCode)
	sc.Step(`^the user imports a row with the IMPA code "([^"]*)"$`, s.importBadCode)
	sc.Step(`^the user creates an item with the IMPA code "([^"]*)"$`, s.createWithCode)
	sc.Step(`^the user creates an item whose name repeats its IMPA code$`, s.createNameRepeatingCode)
	sc.Step(`^the stored name no longer names the code$`, s.storedNameWithoutCode)
	sc.Step(`^the stored item has no IMPA code$`, s.storedWithoutCode)
}
