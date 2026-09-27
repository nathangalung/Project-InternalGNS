package acceptance_test

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"mime/multipart"
	"net/http"

	"github.com/cucumber/godog"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// rfqState is one upload's fixtures.
type rfqState struct {
	itemID  int64
	impa    string
	name    string
	unknown string
	rows    []items.MatchRowInput
}

// freshNumber is a random number.
func freshNumber(n int64) (int64, error) {
	v, err := rand.Int(rand.Reader, big.NewInt(n))
	if err != nil {
		return 0, err
	}
	return v.Int64(), nil
}

func (s *scenarioState) seedRFQItem() error {
	n, err := freshNumber(1_000_000)
	if err != nil {
		return err
	}
	s.rfq = rfqState{
		impa:    fmt.Sprintf("9%06d", n),
		name:    fmt.Sprintf("RFQ Kabel %06d", n),
		unknown: fmt.Sprintf("Qzvx %06d wkjh", n),
	}
	if err := s.sendRequest(http.MethodPost, "/items/", items.CreateItemRequest{
		Name: s.rfq.name, IMPACode: &s.rfq.impa,
	}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("create item: %d %s", s.last.StatusCode, s.body)
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(s.body, &created); err != nil {
		return err
	}
	s.rfq.itemID = created.ID
	testutil.NewCleaner(s.t).Item(created.ID)
	return nil
}

// rfqWorkbook lists the rows.
// A merged DECK STORES row sits above them, as ship RFQs group stores.
func (s *scenarioState) rfqWorkbook() ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	const sh = "Sheet1"
	rows := [][]any{
		{"Kode IMPA", "Nama Produk", "Jumlah", "Satuan"},
		{"DECK STORES"},
		{s.rfq.impa, s.rfq.name, 3, "PCS"},
		{nil, s.rfq.unknown, 2, "PCS"},
	}
	for i, r := range rows {
		cell, err := excelize.CoordinatesToCellName(1, i+1)
		if err != nil {
			return nil, err
		}
		if err := f.SetSheetRow(sh, cell, &r); err != nil {
			return nil, err
		}
	}
	if err := f.MergeCell(sh, "A2", "D2"); err != nil {
		return nil, err
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// uploadRFQ posts one file.
func (s *scenarioState) uploadRFQ(name string, data []byte) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	w, err := mw.CreateFormFile("file", name)
	if err != nil {
		return err
	}
	if _, err := w.Write(data); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, s.srv.URL+"/quotations/rfq", &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := s.srv.Client().Do(req)
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

func (s *scenarioState) uploadRFQWorkbook() error {
	data, err := s.rfqWorkbook()
	if err != nil {
		return err
	}
	return s.uploadRFQ("permintaan.xlsx", data)
}

func (s *scenarioState) uploadTextAs(name string) error {
	return s.uploadRFQ(name, []byte("Nama,Jumlah\nBaut,2\n"))
}

func (s *scenarioState) uploadReturnsRows() error {
	var got quotations.RFQRows
	if err := json.Unmarshal(s.body, &got); err != nil {
		return err
	}
	want := []items.MatchRowInput{
		{IMPACode: s.rfq.impa, Name: s.rfq.name, Qty: 3, Unit: "PCS"},
		{Name: s.rfq.unknown, Qty: 2, Unit: "PCS"},
	}
	if fmt.Sprint(got.Rows) != fmt.Sprint(want) {
		return fmt.Errorf("rows = %+v, want %+v", got.Rows, want)
	}
	s.rfq.rows = got.Rows
	return nil
}

func (s *scenarioState) matchUploadedRows() error {
	return s.sendRequest(http.MethodPost, "/items/match-rows", items.MatchRowsRequest{Rows: s.rfq.rows})
}

func (s *scenarioState) uploadMatched() error {
	var got items.MatchRowsResponse
	if err := json.Unmarshal(s.body, &got); err != nil {
		return err
	}
	if len(got.Rows) != 2 {
		return fmt.Errorf("want 2 match rows, got %d", len(got.Rows))
	}
	first, second := got.Rows[0], got.Rows[1]
	if first.Source != "IMPA_EXACT" || first.Matched == nil || first.Matched.ItemID != s.rfq.itemID {
		return fmt.Errorf("first row = %s %+v, want IMPA_EXACT item %d", first.Source, first.Matched, s.rfq.itemID)
	}
	if second.Source != "NONE" || second.Matched != nil {
		return fmt.Errorf("second row = %s %+v, want NONE", second.Source, second.Matched)
	}
	return nil
}

func registerRFQSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^a catalog item with a fresh IMPA code$`, s.seedRFQItem)
	sc.Step(`^the user uploads an RFQ listing that item and an unknown product under a category row$`, s.uploadRFQWorkbook)
	sc.Step(`^the user uploads a text file named "([^"]+)"$`, s.uploadTextAs)
	sc.Step(`^the upload returns the item and the unknown product$`, s.uploadReturnsRows)
	sc.Step(`^the user matches the uploaded rows against the catalog$`, s.matchUploadedRows)
	sc.Step(`^the item matches by IMPA code and the unknown product matches nothing$`, s.uploadMatched)
}
