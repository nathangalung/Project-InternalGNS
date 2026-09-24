package acceptance_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/cucumber/godog"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
)

// Export columns the list steps read.
const (
	exportDNCol    = 0
	exportPOCol    = 1
	exportTotalCol = 6
)

func (s *scenarioState) editPODetailsDated(poNumber, poDate string) error {
	body := purchaseorders.UpdateDetailsRequest{PoNumber: poNumber, PoDate: poDate}
	return s.sendRequest(http.MethodPatch, s.poPath("/details"), body)
}

func (s *scenarioState) editPODetailsOfLength(n int) error {
	return s.editPODetailsDated(strings.Repeat("9", n), "2026-01-15")
}

func (s *scenarioState) poNumberAndDate(number, date string) error {
	po, err := s.readPO()
	if err != nil {
		return err
	}
	if po.PoNumber != number || po.PoDate.Format(time.DateOnly) != date {
		return fmt.Errorf("want %s dated %s got %s dated %s", number, date, po.PoNumber, po.PoDate.Format(time.DateOnly))
	}
	return nil
}

// The number fn_next_doc_no issued on acceptance.
func (s *scenarioState) poKeepsGeneratedNumber() error {
	po, err := s.readPO()
	if err != nil {
		return err
	}
	if !strings.HasPrefix(po.PoNumber, "PO-") {
		return fmt.Errorf("want the generated PO- number got %q", po.PoNumber)
	}
	return nil
}

// A second PO of the default client takes number.
// The scenario keeps working on the first PO.
func (s *scenarioState) otherPOHoldsNumber(number string) error {
	qID, poID := s.quotationID, s.poID
	defer func() { s.quotationID, s.poID = qID, poID }()
	if err := s.acceptedQuotation(); err != nil {
		return err
	}
	if err := s.editPODetails(number); err != nil {
		return err
	}
	return s.statusEquals(http.StatusNoContent)
}

func (s *scenarioState) listPOsWithTotal(bound, amount string) error {
	key := map[string]string{"least": "minTotal", "most": "maxTotal"}[bound]
	return s.sendRequest(http.MethodGet, "/purchase-orders/?"+url.Values{key: {amount}}.Encode(), nil)
}

func (s *scenarioState) poListHasPO(verb string) error {
	var rows []purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	found := false
	for _, r := range rows {
		found = found || r.ID == s.poID
	}
	if found != (verb == "includes") {
		return fmt.Errorf("want the list to %s PO %d, got %d rows", strings.TrimSuffix(verb, "s"), s.poID, len(rows))
	}
	return nil
}

// exportRowForPO finds this PO's row in the last export.
// It reads the PO number first and restores the export response after.
func (s *scenarioState) exportRowForPO() ([]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(s.body))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetName(0))
	if err != nil {
		return nil, err
	}
	last, body := s.last, s.body
	defer func() { s.last, s.body = last, body }()
	if err := s.readPOByQuotation(); err != nil {
		return nil, err
	}
	po, err := s.readPO()
	if err != nil {
		return nil, err
	}
	for _, row := range rows[1:] {
		if len(row) > exportPOCol && row[exportPOCol] == po.PoNumber {
			return row, nil
		}
	}
	return nil, fmt.Errorf("export has no row for %s: %v", po.PoNumber, rows)
}

func (s *scenarioState) exportShowsPOTotal(want string) error {
	row, err := s.exportRowForPO()
	if err != nil {
		return err
	}
	if len(row) <= exportTotalCol || row[exportTotalCol] != want {
		return fmt.Errorf("want total %s got row %v", want, row)
	}
	return nil
}

func (s *scenarioState) exportHidesDeliveryNote() error {
	row, err := s.exportRowForPO()
	if err != nil {
		return err
	}
	if row[exportDNCol] != "" {
		return fmt.Errorf("want no delivery note number got %q", row[exportDNCol])
	}
	return nil
}

func (s *scenarioState) roleUserListsPOs() error {
	return s.sendAsRole(http.MethodGet, "/api/v1/purchase-orders/", nil)
}

func (s *scenarioState) roleUserReadsPO() error {
	return s.sendAsRole(http.MethodGet, "/api/v1"+s.poPath(""), nil)
}

func registerListDetailsSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^the user edits PO details with number "([^"]+)" dated "([^"]+)"$`, s.editPODetailsDated)
	sc.Step(`^the user edits PO details with a number of (\d+) characters$`, s.editPODetailsOfLength)
	sc.Step(`^the PO number is "([^"]+)" dated "([^"]+)"$`, s.poNumberAndDate)
	sc.Step(`^the PO keeps its generated number$`, s.poKeepsGeneratedNumber)
	sc.Step(`^another PO of the same client holds the number "([^"]+)"$`, s.otherPOHoldsNumber)
	sc.Step(`^the user lists POs with a total of at (least|most) "([^"]+)"$`, s.listPOsWithTotal)
	sc.Step(`^the PO list (includes|excludes) the PO$`, s.poListHasPO)
	sc.Step(`^the export shows the PO total "([^"]+)"$`, s.exportShowsPOTotal)
	sc.Step(`^the export lists no delivery note number for the PO$`, s.exportHidesDeliveryNote)
	sc.Step(`^that user lists the POs$`, s.roleUserListsPOs)
	sc.Step(`^that user reads the PO$`, s.roleUserReadsPO)
}
