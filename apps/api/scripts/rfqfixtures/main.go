// Rfqfixtures writes RFQ upload fixtures.
//
// The server RFQ parser (internal/quotations/rfq.go) is tested against
// these real .xlsx files, which pinned the browser parser before it, so the
// move to excelize was checked against the same bytes. Workbooks are built
// with excelize; cells excelize cannot write (error values, formulas with
// or without a cached result) are patched into the sheet XML afterwards,
// as Excel stores them.
// The output is deterministic: rerunning it rewrites identical bytes.
//
//	cd apps/api && go run ./scripts/rfqfixtures -out internal/quotations/testdata
package main

import (
	"archive/zip"
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/xuri/excelize/v2"
)

// fixture is one workbook.
type fixture struct {
	name  string
	build func(f *excelize.File) error
	// patch maps a first-sheet cell to its raw <c> element.
	patch map[string]string
}

func main() {
	out := flag.String("out", "internal/quotations/testdata", "output directory")
	flag.Parse()
	if err := run(*out); err != nil {
		log.Fatal(err)
	}
}

func run(out string) error {
	if err := os.MkdirAll(out, 0o750); err != nil {
		return fmt.Errorf("create %s: %w", out, err)
	}
	for _, fx := range fixtures() {
		data, err := render(fx)
		if err != nil {
			return fmt.Errorf("%s: %w", fx.name, err)
		}
		if err := os.WriteFile(filepath.Join(out, fx.name), data, 0o600); err != nil {
			return fmt.Errorf("write %s: %w", fx.name, err)
		}
	}
	return nil
}

// render builds one workbook.
func render(fx fixture) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	if err := fx.build(f); err != nil {
		return nil, err
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	if len(fx.patch) == 0 {
		return buf.Bytes(), nil
	}
	return patchSheet(buf.Bytes(), fx.patch)
}

// patchSheet swaps first-sheet cells.
func patchSheet(xlsx []byte, cells map[string]string) ([]byte, error) {
	const part = "xl/worksheets/sheet1.xml"
	zr, err := zip.NewReader(bytes.NewReader(xlsx), int64(len(xlsx)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	found := false
	for _, zf := range zr.File {
		body, err := readPart(zf)
		if err != nil {
			return nil, err
		}
		if zf.Name == part {
			found = true
			if body, err = replaceCells(body, cells); err != nil {
				return nil, err
			}
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: zf.Name, Method: zip.Deflate})
		if err != nil {
			return nil, fmt.Errorf("create %s: %w", zf.Name, err)
		}
		if _, err := w.Write(body); err != nil {
			return nil, fmt.Errorf("write %s: %w", zf.Name, err)
		}
	}
	if !found {
		return nil, fmt.Errorf("part %s not found", part)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("close zip: %w", err)
	}
	return out.Bytes(), nil
}

func readPart(zf *zip.File) ([]byte, error) {
	rc, err := zf.Open()
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", zf.Name, err)
	}
	defer func() { _ = rc.Close() }()
	body, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", zf.Name, err)
	}
	return body, nil
}

// replaceCells swaps placeholder cells.
func replaceCells(sheet []byte, cells map[string]string) ([]byte, error) {
	for ref, raw := range cells {
		re := regexp.MustCompile(`<c r="` + regexp.QuoteMeta(ref) + `"[^>]*?(/>|>.*?</c>)`)
		if n := len(re.FindAllIndex(sheet, -1)); n != 1 {
			return nil, fmt.Errorf("cell %s: %d placeholders, want 1", ref, n)
		}
		sheet = re.ReplaceAllLiteral(sheet, []byte(raw))
	}
	return sheet, nil
}

// rows writes from topLeft.
func rows(f *excelize.File, sheet, topLeft string, data ...[]any) error {
	col, row, err := excelize.CellNameToCoordinates(topLeft)
	if err != nil {
		return fmt.Errorf("cell %s: %w", topLeft, err)
	}
	for i, r := range data {
		cell, err := excelize.CoordinatesToCellName(col, row+i)
		if err != nil {
			return fmt.Errorf("row %d: %w", i, err)
		}
		if err := f.SetSheetRow(sheet, cell, &r); err != nil {
			return fmt.Errorf("row %s: %w", cell, err)
		}
	}
	return nil
}

// first renames the default sheet.
func first(f *excelize.File, name string) error {
	return f.SetSheetName("Sheet1", name)
}

var header = []any{"No", "Kode IMPA", "Nama Produk", "Jumlah", "Satuan"}

func fixtures() []fixture {
	return []fixture{
		{name: "multi-sheet.xlsx", build: multiSheet},
		{name: "display-values.xlsx", build: displayValues, patch: map[string]string{
			"A2": `<c r="A2"><f>370000+115</f><v>370115</v></c>`,
			"C2": `<c r="C2"><f>2*3</f><v>6</v></c>`,
		}},
		{name: "error-cells.xlsx", build: errorCells, patch: map[string]string{
			"A2": `<c r="A2" t="e"><v>#N/A</v></c>`,
			"C2": `<c r="C2" t="e"><f>1/0</f><v>#DIV/0!</v></c>`,
			"B3": `<c r="B3" t="e"><f>VLOOKUP(A3,K:L,2,0)</f><v>#N/A</v></c>`,
		}},
		{name: "uncached-formula.xlsx", build: uncachedFormula, patch: map[string]string{
			"A2": `<c r="A2"><f>K1</f></c>`,
			"B2": `<c r="B2" t="str"><f>VLOOKUP(A2,K:L,2,0)</f></c>`,
		}},
		{name: "offset-table.xlsx", build: offsetTable},
		{name: "no-products.xlsx", build: noProducts},
		{name: "merged-cells.xlsx", build: mergedCells},
		{name: "empty-rows.xlsx", build: emptyRows},
		{name: "numbers-as-text.xlsx", build: numbersAsText},
		{name: "headers-nomor.xlsx", build: headersNomor},
		{name: "headers-kode.xlsx", build: headersKode},
	}
}

// multiSheet: first product sheet.
func multiSheet(f *excelize.File) error {
	if err := first(f, "Kosong"); err != nil {
		return err
	}
	for _, s := range []string{"Catatan", "Produk", "Cadangan"} {
		if _, err := f.NewSheet(s); err != nil {
			return fmt.Errorf("sheet %s: %w", s, err)
		}
	}
	return errors.Join(
		rows(f, "Catatan", "A1", []any{"Dikirim ke Batam"}),
		rows(f, "Produk", "A1",
			[]any{"Kode IMPA", "Nama Produk", "Jumlah", "Satuan"},
			[]any{"370115", "Marine Radio", 2, "PCS"}),
		rows(f, "Cadangan", "A1",
			[]any{"Nama", "Jumlah"},
			[]any{"Tidak terbaca", 9}),
	)
}

// displayValues: formula, link, richtext.
func displayValues(f *excelize.File) error {
	const s = "Produk"
	if err := first(f, s); err != nil {
		return err
	}
	shipped := time.Date(2026, 9, 24, 0, 0, 0, 0, time.UTC)
	return errors.Join(
		rows(f, s, "A1",
			[]any{"Kode", "Nama", "Jumlah", "Satuan", "Tanggal"},
			[]any{0, "Tali Nylon", 0, "", shipped}),
		f.SetCellHyperLink(s, "B2", "https://gns.id/tali", "External"),
		f.SetCellRichText(s, "D2", []excelize.RichTextRun{
			{Text: "RO", Font: &excelize.Font{Bold: true}},
			{Text: "LL"},
		}),
	)
}

// errorCells: errors read blank.
func errorCells(f *excelize.File) error {
	const s = "Produk"
	if err := first(f, s); err != nil {
		return err
	}
	return rows(f, s, "A1",
		[]any{"Kode", "Nama", "Jumlah", "Satuan"},
		[]any{0, "Mur", 0, "PCS"},
		[]any{"370115", 0, 2, "PCS"})
}

// uncachedFormula: uncached reads blank.
func uncachedFormula(f *excelize.File) error {
	const s = "Produk"
	if err := first(f, s); err != nil {
		return err
	}
	return rows(f, s, "A1",
		[]any{"Kode", "Nama", "Jumlah"},
		[]any{0, 0, 1},
		[]any{"370115", "Mur", 2})
}

// offsetTable: table starts at B3.
func offsetTable(f *excelize.File) error {
	const s = "Produk"
	if err := first(f, s); err != nil {
		return err
	}
	return rows(f, s, "B3",
		[]any{"Nama", "Jumlah"},
		[]any{"Baut", 2})
}

// noProducts: no name column anywhere.
func noProducts(f *excelize.File) error {
	const s = "Catatan"
	if err := first(f, s); err != nil {
		return err
	}
	return rows(f, s, "A1", []any{"Tidak ada produk"})
}

// mergedCells: banner, header, category.
func mergedCells(f *excelize.File) error {
	const s = "RFQ"
	if err := first(f, s); err != nil {
		return err
	}
	return errors.Join(
		rows(f, s, "A1",
			[]any{"PERMINTAAN KAPAL MV SINAR BAHARI"},
			[]any{"No", "Produk", nil, "Jumlah", "Satuan"},
			[]any{nil, "Kode IMPA", "Nama"},
			[]any{"DECK STORES"},
			[]any{1, "370115", "Marine Radio", 2, "PCS"},
			[]any{2, "210101", "Tali Tambang", 5, "MTR"}),
		f.MergeCell(s, "A1", "E1"),
		f.MergeCell(s, "B2", "C2"),
		f.MergeCell(s, "A2", "A3"),
		f.MergeCell(s, "D2", "D3"),
		f.MergeCell(s, "E2", "E3"),
		f.MergeCell(s, "A4", "E4"),
	)
}

// emptyRows: blank rows skipped.
func emptyRows(f *excelize.File) error {
	const s = "RFQ"
	if err := first(f, s); err != nil {
		return err
	}
	style, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return fmt.Errorf("style: %w", err)
	}
	return errors.Join(
		rows(f, s, "A1", []any{"RFQ MV SINAR BAHARI"}),
		// Styled but empty cells, as a formatted template leaves.
		f.SetCellStyle(s, "A5", "E5", style),
		f.SetCellStyle(s, "A12", "E12", style),
		rows(f, s, "A22", header, []any{1, "370115", "Marine Radio", 2, "PCS"}),
		rows(f, s, "A26", []any{2, "210101", "Tali Tambang", 5, "MTR"}),
		f.SetCellStyle(s, "A30", "E30", style),
	)
}

// numbersAsText: text numbers, leading zeros.
func numbersAsText(f *excelize.File) error {
	const s = "RFQ"
	if err := first(f, s); err != nil {
		return err
	}
	pad := "000000"
	style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &pad})
	if err != nil {
		return fmt.Errorf("style: %w", err)
	}
	return errors.Join(
		rows(f, s, "A1",
			header,
			[]any{1, "012345", "Cat Kapal", "1.000", "KG"},
			[]any{2, 12345, "Kuas", "2,5", "PCS"},
			[]any{3, "370115", "Marine Radio", 4, "SET"},
			[]any{"4", 370116, "Lampu", " 7 ", " pcs "},
			[]any{5, "  ", "  ", 1, "PCS"}),
		f.SetCellStyle(s, "B3", "B3", style),
	)
}

// headersNomor: Nomor, Deskripsi, Kuantitas.
func headersNomor(f *excelize.File) error {
	const s = "Kebutuhan"
	if err := first(f, s); err != nil {
		return err
	}
	return rows(f, s, "A1",
		[]any{"DAFTAR KEBUTUHAN KAPAL"},
		[]any{"Nomor", "Kode IMPA", "Deskripsi", "Kuantitas", "Satuan"},
		[]any{1, "232001", "Sarung Tangan", 12, "PSG"})
}

// headersKode: Kode, Produk, Unit.
func headersKode(f *excelize.File) error {
	const s = "Kebutuhan"
	if err := first(f, s); err != nil {
		return err
	}
	return rows(f, s, "A1",
		[]any{" NO ", " KODE ", " PRODUK ", " JUMLAH ", " UNIT "},
		[]any{1, "150101", "Baut M10", "1.500", "PCS"})
}
