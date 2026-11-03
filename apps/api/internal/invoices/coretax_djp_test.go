package invoices

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// The rules below come from DJP's own files: "Sample Faktur PK Template
// v.1.4.xml" and the Keterangan sheet of "Sample Faktur PK Template
// v.1.6.1.xlsx", both shipped in ConverterEfakturCoretax v1.6.

var djpSettings = deps.CoretaxSettings{SellerTIN: "0626381321011000", SellerIDTKU: "0626381321011000000000"}

// djpFixture is two invoices, two lines then one.
func djpFixture() ([]Invoice, map[int64][]InvoiceItem, map[int64]clients.Client) {
	line := func(name, impa string) InvoiceItem {
		return InvoiceItem{
			ItemName: name, ItemCode: sptr(impa), Qty: "1", UnitPrice: "100000",
			Dpp: sptr("100000"), DppNilaiLain: sptr("91666.67"),
			PpnRate: sptr("12"), PpnAmount: sptr("11000"), UnitCoretaxCode: sptr("UM.0021"),
		}
	}
	invs := []Invoice{
		{ID: 1, InvoiceNo: "INV-00001/GNS/XI/2026", CompanyClientID: 10, CompanyName: "PT Satu",
			CompanyNpwp: sptr("0123456789012345"), CompanyAddress: sptr("Jakarta"),
			InvoiceDate: time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)},
		{ID: 2, InvoiceNo: "INV-00002/GNS/XI/2026", CompanyClientID: 10, CompanyName: "PT Satu",
			CompanyNpwp: sptr("0123456789012345"), CompanyAddress: sptr("Jakarta"),
			InvoiceDate: time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)},
	}
	items := map[int64][]InvoiceItem{
		1: {line("Tali Tambat", "210101"), line("Sarung Tangan", "190105")},
		2: {line("Cat Anti Karat", "250201")},
	}
	buyers := map[int64]clients.Client{10: {ID: 10, Name: "PT Satu", CountryCode: "IDN"}}
	return invs, items, buyers
}

func TestCoretaxXML_FollowsDJPSample(t *testing.T) {
	t.Parallel()
	invs, items, buyers := djpFixture()
	h := &CoretaxHandler{settings: djpSettings}
	body, err := xml.Marshal(h.buildBulk(invs[0], items[1], buyers[10]))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	// DJP's TaxInvoice children, in sequence.
	want := []string{
		"TaxInvoiceDate", "TaxInvoiceOpt", "TrxCode", "AddInfo", "CustomDoc",
		"CustomDocMonthYear", "RefDesc", "FacilityStamp", "SellerIDTKU", "BuyerTin",
		"BuyerDocument", "BuyerCountry", "BuyerDocumentNumber", "BuyerName",
		"BuyerAdress", "BuyerEmail", "BuyerIDTKU", "ListOfGoodService",
	}
	if got := childNames(t, body, "TaxInvoice"); !reflect.DeepEqual(got, want) {
		t.Fatalf("TaxInvoice children\n got %v\nwant %v", got, want)
	}

	// Kode Barang Jasa must come from DJP's reference, which IMPA is not.
	var doc struct {
		Codes []string `xml:"ListOfTaxInvoice>TaxInvoice>ListOfGoodService>GoodService>Code"`
	}
	if err := xml.Unmarshal(body, &doc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(doc.Codes, []string{"000000", "000000"}) {
		t.Fatalf("codes = %v, want 000000 on every line", doc.Codes)
	}
}

// childNames lists one element's children.
func childNames(t *testing.T, body []byte, parent string) []string {
	t.Helper()
	dec := xml.NewDecoder(bytes.NewReader(body))
	depth, inside := 0, -1
	var out []string
	for {
		tok, err := dec.Token()
		if err != nil {
			return out
		}
		switch el := tok.(type) {
		case xml.StartElement:
			depth++
			if inside < 0 && el.Name.Local == parent {
				inside = depth
			} else if inside > 0 && depth == inside+1 {
				out = append(out, el.Name.Local)
			}
		case xml.EndElement:
			if depth == inside {
				return out
			}
			depth--
		}
	}
}

func TestBuildCoretaxWorkbook_FollowsDJPTemplate(t *testing.T) {
	t.Parallel()
	invs, items, buyers := djpFixture()
	out, err := buildCoretaxWorkbook(loadTemplate(t), djpSettings, invs, items, buyers)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	cell := func(sheet, ref string) string {
		v, _ := f.GetCellValue(sheet, ref)
		return v
	}

	// Faktur: Baris 1 and 2 on rows 4 and 5, then END.
	for row, want := range map[int]string{4: "1", 5: "2", 6: "END"} {
		if got := cell(coretaxSheetFaktur, fmt.Sprintf("A%d", row)); got != want {
			t.Errorf("Faktur A%d = %q, want %q", row, got, want)
		}
	}
	// Optional Faktur fields stay truly empty.
	for _, col := range []string{"E", "F", "G", "I"} {
		if typ, _ := f.GetCellType(coretaxSheetFaktur, col+"4"); typ != excelize.CellTypeUnset {
			t.Errorf("Faktur %s4 is written (%v), want an empty cell", col, typ)
		}
	}

	// DetailFaktur: Baris names the parent Faktur row, then END.
	for row, want := range map[int]string{2: "1", 3: "1", 4: "2", 5: "END"} {
		if got := cell(coretaxSheetDetail, fmt.Sprintf("A%d", row)); got != want {
			t.Errorf("DetailFaktur A%d = %q, want %q", row, got, want)
		}
	}
	for row := 2; row <= 4; row++ {
		if got := cell(coretaxSheetDetail, fmt.Sprintf("C%d", row)); got != "000000" {
			t.Errorf("DetailFaktur C%d = %q, want 000000", row, got)
		}
	}

	// DJP's DetailFaktur has fourteen columns, A to N.
	header, err := f.GetRows(coretaxSheetDetail)
	if err != nil || len(header) == 0 {
		t.Fatalf("detail rows: %v", err)
	}
	if len(header[0]) != 14 || header[0][13] != "PPnBM" {
		t.Fatalf("DetailFaktur header = %v, want 14 columns ending in PPnBM", header[0])
	}
}
