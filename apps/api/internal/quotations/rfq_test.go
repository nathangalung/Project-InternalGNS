package quotations

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
)

type rfqRow = items.MatchRowInput

var (
	rfqRadio = rfqRow{IMPACode: "370115", Name: "Marine Radio", Qty: 2, Unit: "PCS"}
	rfqRope  = rfqRow{IMPACode: "210101", Name: "Tali Tambang", Qty: 5, Unit: "MTR"}
)

// rfqFixtures pins every testdata workbook.
//
// The expectations are the ones the browser parser was pinned to in 504e434,
// except the two bugs the move fixed: the merged DECK STORES category row is
// skipped, and a numeric IMPA code keeps the zeros its format displays.
var rfqFixtures = []struct {
	file string
	want []rfqRow
	err  error
}{
	{file: "multi-sheet.xlsx", want: []rfqRow{rfqRadio}},
	{file: "display-values.xlsx", want: []rfqRow{
		{IMPACode: "370115", Name: "Tali Nylon", Qty: 6, Unit: "ROLL"},
	}},
	{file: "error-cells.xlsx", want: []rfqRow{
		{IMPACode: "", Name: "Mur", Qty: 0, Unit: "PCS"},
	}},
	{file: "uncached-formula.xlsx", want: []rfqRow{
		{IMPACode: "370115", Name: "Mur", Qty: 2, Unit: ""},
	}},
	{file: "offset-table.xlsx", want: []rfqRow{
		{IMPACode: "", Name: "Baut", Qty: 2, Unit: ""},
	}},
	// "Tidak ada produk" reads as a name header with nothing under it.
	{file: "no-products.xlsx", err: errRFQNoRows},
	{file: "merged-cells.xlsx", want: []rfqRow{rfqRadio, rfqRope}},
	{file: "empty-rows.xlsx", want: []rfqRow{rfqRadio, rfqRope}},
	{file: "numbers-as-text.xlsx", want: []rfqRow{
		{IMPACode: "012345", Name: "Cat Kapal", Qty: 1000, Unit: "KG"},
		{IMPACode: "012345", Name: "Kuas", Qty: 2.5, Unit: "PCS"},
		{IMPACode: "370115", Name: "Marine Radio", Qty: 4, Unit: "SET"},
		{IMPACode: "370116", Name: "Lampu", Qty: 7, Unit: "pcs"},
	}},
	{file: "headers-nomor.xlsx", want: []rfqRow{
		{IMPACode: "232001", Name: "Sarung Tangan", Qty: 12, Unit: "PSG"},
	}},
	{file: "headers-kode.xlsx", want: []rfqRow{
		{IMPACode: "150101", Name: "Baut M10", Qty: 1500, Unit: "PCS"},
	}},
}

func TestParseRFQ_Fixtures(t *testing.T) {
	for _, tc := range rfqFixtures {
		t.Run(tc.file, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("testdata", tc.file))
			require.NoError(t, err)
			// Upper-case extension: detection ignores case.
			got, err := ParseRFQ(strings.ToUpper(tc.file), data)
			if tc.err != nil {
				require.ErrorIs(t, err, tc.err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// Generator and table stay in sync.
func TestParseRFQ_EveryFixtureHasACase(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "*.xlsx"))
	require.NoError(t, err)
	have := make([]string, 0, len(files))
	for _, f := range files {
		have = append(have, filepath.Base(f))
	}
	want := make([]string, 0, len(rfqFixtures))
	for _, tc := range rfqFixtures {
		want = append(want, tc.file)
	}
	slices.Sort(want)
	assert.Equal(t, want, have)
}

func TestParseQtyText(t *testing.T) {
	cases := []struct {
		in   string
		want float64
	}{
		{"10", 10},
		{"1.000", 1000},
		{"1.234.567", 1234567},
		{"1,5", 1.5},
		{"1.234.567,89", 1234567.89},
		{" 7 ", 7},
		{"1.5", 1.5},
		{"1.2345", 1.2345},
		{"12.000 pcs", 0},
		{"", 0},
		{"abc", 0},
		{".", 0},
		{"Infinity", 0},
		{"NaN", 0},
		{"-2", -2},
		{"1.23,5", 0},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, parseQtyText(c.in), "input %q", c.in)
	}
}

// gridRows parses a plain grid.
func gridRows(rows [][]string) ([]rfqRow, bool, error) {
	return textSheet(rows).products()
}

func TestProducts_HeaderDetection(t *testing.T) {
	header := []string{"No", "Kode IMPA", "Nama Produk", "Jumlah", "Satuan"}
	cases := []struct {
		name  string
		rows  [][]string
		want  []rfqRow
		found bool
	}{
		{
			name:  "header first",
			rows:  [][]string{header, {"1", "370115", "Marine Radio", "2", "PCS"}},
			want:  []rfqRow{rfqRadio},
			found: true,
		},
		{
			name:  "an English IMPA form",
			rows:  [][]string{{"No", "IMPA", "Description", "Qty", "Unit"}, {"1", "370115", "Marine Radio", "2", "PCS"}},
			want:  []rfqRow{rfqRadio},
			found: true,
		},
		{
			name: "title banner above the header",
			rows: [][]string{
				{"DAFTAR PRODUK PT GLOBAL", "", "", "", ""},
				{"", "", "", "", ""},
				header,
				{"1", "370115", "Marine Radio", "1.000", "PCS"},
			},
			want:  []rfqRow{{IMPACode: "370115", Name: "Marine Radio", Qty: 1000, Unit: "PCS"}},
			found: true,
		},
		{
			name: "no name column",
			rows: [][]string{{"Foo", "Bar"}, {"a", "b"}},
		},
		{
			name:  "barcode is not the IMPA code",
			rows:  [][]string{{"Barcode", "Nama", "Jumlah"}, {"999", "Bolt", "3"}},
			want:  []rfqRow{{Name: "Bolt", Qty: 3}},
			found: true,
		},
		{
			name: "blank rows and rows without a name",
			rows: [][]string{
				header,
				{},
				{"", "", "", "", ""},
				{"2", "370116", "   ", "3", "PCS"},
				{"3", "", "Baut", "4", ""},
			},
			want:  []rfqRow{{Name: "Baut", Qty: 4}},
			found: true,
		},
		{
			name:  "quantity and unit columns missing",
			rows:  [][]string{{"Nama"}, {"Tali"}},
			want:  []rfqRow{{Name: "Tali"}},
			found: true,
		},
		{
			name:  "richest header row wins",
			rows:  [][]string{{"Nama Kapal", "", ""}, {"Nama", "Qty", "Unit"}, {"Mur", "5", "PCS"}},
			want:  []rfqRow{{Name: "Mur", Qty: 5, Unit: "PCS"}},
			found: true,
		},
		{
			name:  "a later look-alike row is data",
			rows:  [][]string{{"Nama", "Jumlah"}, {"Nama Baut", "2"}},
			want:  []rfqRow{{Name: "Nama Baut", Qty: 2}},
			found: true,
		},
		{
			name:  "short data row",
			rows:  [][]string{header, {"1"}},
			want:  []rfqRow{},
			found: true,
		},
		{
			name: "header past the scan window",
			rows: append(slices.Repeat([][]string{{"catatan"}}, rfqHeaderScan),
				[]string{"Nama"}, []string{"Baut"}),
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, found, err := gridRows(c.rows)
			require.NoError(t, err)
			assert.Equal(t, c.found, found)
			if c.found {
				assert.Equal(t, c.want, got)
			}
		})
	}
}

func TestParseRFQ_CSV(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []rfqRow
		err  error
	}{
		{
			name: "plain rows",
			in:   "Nama,Jumlah,Satuan\nBaut,2,PCS\n",
			want: []rfqRow{{Name: "Baut", Qty: 2, Unit: "PCS"}},
		},
		{
			name: "quotes, escaped quotes, CRLF and a BOM",
			in:   "\ufeffNama,\"Jumlah\"\r\n\"Baut \"\"M10\"\", hitam\",\"1.500\"\r\n",
			want: []rfqRow{{Name: `Baut "M10", hitam`, Qty: 1500}},
		},
		{
			name: "ragged rows",
			in:   "Kode,Nama,Jumlah\n370115,Marine Radio\n,,\n",
			want: []rfqRow{{IMPACode: "370115", Name: "Marine Radio"}},
		},
		{name: "empty file", in: "", err: errRFQEmpty},
		{name: "blank lines only", in: ",,\n\n", err: errRFQEmpty},
		{name: "no header", in: "a,b\n1,2\n", err: errRFQNoHeader},
		{name: "header without rows", in: "Nama,Jumlah\n", err: errRFQNoRows},
		{
			name: "a bare inch mark",
			in:   "Nama\nPipa 2\" galvanis\n",
			want: []rfqRow{{Name: `Pipa 2" galvanis`}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseRFQ("permintaan.csv", []byte(c.in))
			if c.err != nil {
				require.ErrorIs(t, err, c.err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, c.want, got)
		})
	}
}

func TestParseRFQ_CSVTooManyRows(t *testing.T) {
	var b strings.Builder
	b.WriteString("Nama\n")
	for i := range rfqMaxRows {
		fmt.Fprintf(&b, "Baut %d\n", i)
	}
	_, err := ParseRFQ("a.csv", []byte(b.String()))
	require.ErrorIs(t, err, errRFQTooBig)
}

// buildXLSX writes one workbook.
func buildXLSX(t *testing.T, build func(f *excelize.File)) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	build(f)
	buf, err := f.WriteToBuffer()
	require.NoError(t, err)
	return buf.Bytes()
}

func setRows(t *testing.T, f *excelize.File, topLeft string, rows ...[]any) {
	t.Helper()
	col, row, err := excelize.CellNameToCoordinates(topLeft)
	require.NoError(t, err)
	for i, r := range rows {
		cell, err := excelize.CoordinatesToCellName(col, row+i)
		require.NoError(t, err)
		require.NoError(t, f.SetSheetRow("Sheet1", cell, &r))
	}
}

// zipOf writes a raw zip.
func zipOf(t *testing.T, parts map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	names := make([]string, 0, len(parts))
	for n := range parts {
		names = append(names, n)
	}
	slices.Sort(names)
	for _, n := range names {
		w, err := zw.Create(n)
		require.NoError(t, err)
		_, err = w.Write([]byte(parts[n]))
		require.NoError(t, err)
	}
	require.NoError(t, zw.Close())
	return buf.Bytes()
}

func TestParseRFQ_XLSXRefusals(t *testing.T) {
	manyMerges := buildXLSX(t, func(f *excelize.File) {
		setRows(t, f, "A1", []any{"Nama"}, []any{"Baut"})
		for i := range rfqMaxMerges + 1 {
			a, _ := excelize.CoordinatesToCellName(3, i+1)
			b, _ := excelize.CoordinatesToCellName(4, i+1)
			require.NoError(t, f.MergeCell("Sheet1", a, b))
		}
	})
	manyRows := buildXLSX(t, func(f *excelize.File) {
		setRows(t, f, "A1", []any{"Nama"})
		sw, err := f.NewStreamWriter("Sheet1")
		require.NoError(t, err)
		for i := range rfqMaxRows + 1 {
			cell, _ := excelize.CoordinatesToCellName(1, i+1)
			require.NoError(t, sw.SetRow(cell, []any{"Baut"}))
		}
		require.NoError(t, sw.Flush())
	})
	bigPart := zipOf(t, map[string]string{"xl/big.bin": strings.Repeat("0", rfqMaxUnzip+1)})
	cases := []struct {
		name string
		data []byte
		err  error
	}{
		{name: "not a zip", data: []byte("Nama,Jumlah\nBaut,2\n"), err: errRFQFormat},
		{name: "old xls header", data: []byte("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest"), err: errRFQFormat},
		{name: "a zip that is no workbook", data: zipOf(t, map[string]string{"a.txt": "x"}), err: errRFQFormat},
		{name: "unzips past the limit", data: bigPart, err: errRFQTooBig},
		{name: "too many rows", data: manyRows, err: errRFQTooBig},
		{name: "too many merged ranges", data: manyMerges, err: errRFQTooBig},
		{name: "a merge filling past the cell budget", data: buildXLSX(t, func(f *excelize.File) {
			setRows(t, f, "A1", []any{"Nama"})
			require.NoError(t, f.MergeCell("Sheet1", "A1", "BL5001"))
		}), err: errRFQTooBig},
		{name: "a merge filling past the row cap", data: buildXLSX(t, func(f *excelize.File) {
			setRows(t, f, "A1", []any{"Nama"}, []any{"Baut"})
			require.NoError(t, f.MergeCell("Sheet1", "B2", "B5002"))
			require.NoError(t, f.SetCellValue("Sheet1", "B2", "x"))
		}), err: errRFQTooBig},
		{name: "empty workbook", data: buildXLSX(t, func(*excelize.File) {}), err: errRFQEmpty},
		{name: "header without rows", data: buildXLSX(t, func(f *excelize.File) {
			setRows(t, f, "A1", []any{"Nama", "Jumlah"})
		}), err: errRFQNoRows},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseRFQ("rfq.xlsx", c.data)
			require.ErrorIs(t, err, c.err)
		})
	}
}

// sheetRows repeats one row template.
func sheetRows(from, n int, tmpl string) string {
	var b strings.Builder
	for r := from; r < from+n; r++ {
		b.WriteString(strings.ReplaceAll(tmpl, "{r}", fmt.Sprint(r)))
	}
	return b.String()
}

// Small uploads that expand in memory.
func TestParseRFQ_XLSXExpansion(t *testing.T) {
	base, err := os.ReadFile(filepath.Join("testdata", "offset-table.xlsx"))
	require.NoError(t, err)
	const sheet = "xl/worksheets/sheet1.xml"
	extraRows := func(rows string) []byte {
		return patchPart(t, base, sheet, `</sheetData>`, rows+`</sheetData>`)
	}
	cases := []struct {
		name string
		data []byte
	}{
		{name: "bare cells past the budget", data: extraRows(`<row r="5">` + strings.Repeat("<c/>", rfqMaxUnits) + `</row>`)},
		{name: "rows padded out to the last column", data: extraRows(sheetRows(5, rfqMaxUnits/excelize.MaxColumns+1, `<row r="{r}"><c r="XFD{r}" s="1"/></row>`))},
		{name: "a row numbered past the row cap", data: extraRows(fmt.Sprintf(`<row r="%d"><c r="A%[1]d" s="1"/></row>`, rfqMaxRows+1))},
		{name: "an unnumbered row holding a far cell", data: extraRows(fmt.Sprintf(`<row><c r="A%d" s="1"/></row>`, rfqMaxRows+1))},
		{name: "unnumbered rows past the row cap", data: extraRows(strings.Repeat("<row/>", rfqMaxRows))},
		{name: "styled empty rows past the row cap", data: extraRows(sheetRows(5, rfqMaxRows, `<row r="{r}"><c r="A{r}" s="1"/></row>`))},
		// encoding/xml keeps the last duplicate attribute, prefix or not.
		{name: "a duplicate cell r", data: extraRows(sheetRows(5, rfqMaxUnits/excelize.MaxColumns+1, `<row r="{r}"><c r="A{r}" r="XFD{r}" s="1"/></row>`))},
		{name: "a namespaced cell r", data: extraRows(sheetRows(5, rfqMaxUnits/excelize.MaxColumns+1, `<row r="{r}"><c r="A{r}" x:r="XFD{r}" xmlns:x="u" s="1"/></row>`))},
		{name: "a duplicate row r", data: extraRows(`<row r="5" r="1048000"><c s="1"/></row>`)},
		{name: "styles past the budget", data: patchPart(t, base, "xl/styles.xml", `</cellXfs>`, strings.Repeat("<xf/>", rfqMaxUnits)+`</cellXfs>`)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			require.Less(t, len(c.data), rfqMaxBytes)
			_, err := ParseRFQ("rfq.xlsx", c.data)
			require.ErrorIs(t, err, errRFQTooBig)
		})
	}
}

// The largest real RFQ fits.
func TestParseRFQ_LargestSheet(t *testing.T) {
	header := []any{"No", "Kode IMPA", "Nama Produk", "Jumlah", "Satuan", "Merek", "Tipe", "Ukuran", "Warna", "Catatan"}
	data := buildXLSX(t, func(f *excelize.File) {
		sw, err := f.NewStreamWriter("Sheet1")
		require.NoError(t, err)
		require.NoError(t, sw.SetRow("A1", header))
		for i := 2; i <= rfqMaxRows; i++ {
			cell, _ := excelize.CoordinatesToCellName(1, i)
			require.NoError(t, sw.SetRow(cell, []any{i, fmt.Sprintf("%06d", i), fmt.Sprintf("Produk %d", i), i % 50, "PCS", "Merek", "Tipe", "10 mm", "Hitam", "Catatan"}))
		}
		require.NoError(t, sw.Flush())
	})
	got, err := ParseRFQ("rfq.xlsx", data)
	require.NoError(t, err)
	require.Len(t, got, rfqMaxRows-1)
	assert.Equal(t, rfqRow{IMPACode: "005000", Name: "Produk 5000", Qty: 0, Unit: "PCS"}, got[len(got)-1])
}

func TestParseRFQ_UnsupportedExtension(t *testing.T) {
	for _, name := range []string{"rfq.xls", "rfq.pdf", "rfq", ""} {
		_, err := ParseRFQ(name, []byte("x"))
		require.ErrorIs(t, err, errRFQFormat, name)
	}
}

func TestParseRFQ_XLSXCells(t *testing.T) {
	thousands := "#,##0"
	data := buildXLSX(t, func(f *excelize.File) {
		style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &thousands})
		require.NoError(t, err)
		setRows(t, f, "A1",
			[]any{"Nama", "Jumlah", "Satuan", "Catatan"},
			// A thousands format must not read as an id-ID decimal.
			[]any{"Cat", 1500, "KG"},
			// A boolean quantity reads as zero, as text would.
			[]any{"Kuas", true, "PCS"},
			// A far column is cut off without failing the row.
			[]any{"Lampu", 3, "SET"},
			// Merged product cells keep the row when the name stays apart.
			[]any{"Tali", 4, "MTR", "gulung"},
		)
		require.NoError(t, f.SetCellStyle("Sheet1", "B2", "B2", style))
		require.NoError(t, f.SetCellValue("Sheet1", "ZZ4", "jauh"))
		require.NoError(t, f.MergeCell("Sheet1", "C5", "D5"))
	})
	got, err := ParseRFQ("rfq.xlsx", data)
	require.NoError(t, err)
	assert.Equal(t, []rfqRow{
		{Name: "Cat", Qty: 1500, Unit: "KG"},
		{Name: "Kuas", Qty: 0, Unit: "PCS"},
		{Name: "Lampu", Qty: 3, Unit: "SET"},
		{Name: "Tali", Qty: 4, Unit: "MTR"},
	}, got)
}

// Category row spans the table.
func TestParseRFQ_CategoryRows(t *testing.T) {
	cases := []struct {
		name   string
		row    []any
		merges [][2]string
		want   []rfqRow
	}{
		{
			name:   "a category across the table is skipped",
			row:    []any{"ENGINE STORES"},
			merges: [][2]string{{"A2", "D2"}},
			want:   []rfqRow{rfqRadio},
		},
		{
			name:   "a name merged into the quantity is skipped",
			row:    []any{nil, "DECK"},
			merges: [][2]string{{"B2", "C2"}},
			want:   []rfqRow{rfqRadio},
		},
		{
			name:   "merged code+name with a quantity stays a product",
			row:    []any{"Marine Radio tanpa kode", nil, 2, "PCS"},
			merges: [][2]string{{"A2", "B2"}},
			want: []rfqRow{
				{IMPACode: "Marine Radio tanpa kode", Name: "Marine Radio tanpa kode", Qty: 2, Unit: "PCS"},
				rfqRadio,
			},
		},
		{
			name:   "merged code+name without a quantity is skipped",
			row:    []any{"DECK STORES", nil, nil, "PCS"},
			merges: [][2]string{{"A2", "B2"}},
			want:   []rfqRow{rfqRadio},
		},
		{
			name:   "a name merged down fills both rows",
			row:    []any{"232001", "Sarung Tangan", 12, "PSG"},
			merges: [][2]string{{"B2", "B3"}},
			want: []rfqRow{
				{IMPACode: "232001", Name: "Sarung Tangan", Qty: 12, Unit: "PSG"},
				{IMPACode: "370115", Name: "Sarung Tangan", Qty: 2, Unit: "PCS"},
			},
		},
		{
			name:   "a merge past the column cap is ignored",
			row:    []any{"210101", "Tali Tambang", 5, "MTR"},
			merges: [][2]string{{"ZZ1", "ZZ2"}},
			want:   []rfqRow{rfqRope, rfqRadio},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data := buildXLSX(t, func(f *excelize.File) {
				setRows(t, f, "A1",
					[]any{"Kode", "Nama", "Jumlah", "Satuan"},
					c.row,
					[]any{"370115", "Marine Radio", 2, "PCS"},
				)
				for _, m := range c.merges {
					require.NoError(t, f.MergeCell("Sheet1", m[0], m[1]))
				}
			})
			got, err := ParseRFQ("rfq.xlsx", data)
			require.NoError(t, err)
			assert.Equal(t, c.want, got)
		})
	}
}

func TestNumericQty(t *testing.T) {
	cases := []struct {
		raw  string
		want float64
		ok   bool
	}{
		{"1500", 1500, true},
		{" 2.5 ", 2.5, true},
		{"", 0, false},
		{"abc", 0, false},
		{"1e400", 0, false},
	}
	for _, c := range cases {
		got, ok := numericQty(c.raw)
		assert.Equal(t, c.ok, ok, c.raw)
		assert.Equal(t, c.want, got, c.raw)
	}
	assert.False(t, math.IsInf(parseQtyText("1e400"), 0))
}

func TestRFQErrorsAreDistinct(t *testing.T) {
	all := []error{errRFQFormat, errRFQTooBig, errRFQEmpty, errRFQNoHeader, errRFQNoRows}
	for i, a := range all {
		for j, b := range all {
			assert.Equal(t, i == j, errors.Is(a, b))
		}
	}
}

// patchPart rewrites one zip part.
func patchPart(t *testing.T, data []byte, part, old, repl string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	found := false
	for _, zf := range zr.File {
		rc, err := zf.Open()
		require.NoError(t, err)
		body, err := io.ReadAll(rc)
		require.NoError(t, err)
		require.NoError(t, rc.Close())
		if zf.Name == part {
			require.Contains(t, string(body), old)
			body = []byte(strings.Replace(string(body), old, repl, 1))
			found = true
		}
		w, err := zw.Create(zf.Name)
		require.NoError(t, err)
		_, err = w.Write(body)
		require.NoError(t, err)
	}
	require.True(t, found, part)
	require.NoError(t, zw.Close())
	return buf.Bytes()
}

// rawZip stores one part as given.
func rawZip(t *testing.T, method uint16, body []byte, size uint64) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.CreateRaw(&zip.FileHeader{
		Name:               "xl/worksheets/sheet1.xml",
		Method:             method,
		CRC32:              0xdeadbeef,
		CompressedSize64:   uint64(len(body)),
		UncompressedSize64: size,
	})
	require.NoError(t, err)
	_, err = w.Write(body)
	require.NoError(t, err)
	require.NoError(t, zw.Close())
	return buf.Bytes()
}

func TestParseRFQ_MalformedWorkbooks(t *testing.T) {
	base, err := os.ReadFile(filepath.Join("testdata", "offset-table.xlsx"))
	require.NoError(t, err)
	const sheet = "xl/worksheets/sheet1.xml"
	cases := []struct {
		name string
		data []byte
		err  error
	}{
		{
			name: "no sheets",
			data: patchPart(t, base, "xl/workbook.xml",
				`<sheets><sheet name="Produk" sheetId="1" r:id="rId1"></sheet></sheets>`, `<sheets></sheets>`),
			err: errRFQFormat,
		},
		{
			name: "missing sheet part",
			data: patchPart(t, base, "xl/_rels/workbook.xml.rels",
				`Target="worksheets/sheet1.xml"`, `Target="worksheets/missing.xml"`),
			err: errRFQFormat,
		},
		{name: "bad cell reference", data: patchPart(t, base, sheet, `r="B3"`, `r="3B"`), err: errRFQFormat},
		{name: "row past the sheet", data: patchPart(t, base, sheet, `<row r="4">`, `<row r="1048577">`), err: errRFQFormat},
		{name: "first row past the sheet", data: patchPart(t, base, sheet, `<row r="3">`, `<row r="1048577">`), err: errRFQFormat},
		{
			name: "bad merged range",
			data: patchPart(t, base, sheet, `</sheetData>`,
				`</sheetData><mergeCells count="1"><mergeCell ref="A0:B1"></mergeCell></mergeCells>`),
			err: errRFQFormat,
		},
		{name: "corrupt part", data: rawZip(t, zip.Store, []byte("<x/>"), 4), err: errRFQFormat},
		{name: "unknown compression", data: rawZip(t, 99, []byte("<x/>"), 4), err: errRFQFormat},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseRFQ("rfq.xlsx", c.data)
			require.ErrorIs(t, err, c.err)
		})
	}
}

// A merged quantity reads its source.
func TestParseRFQ_MergedQuantity(t *testing.T) {
	thousands := "#,##0"
	data := buildXLSX(t, func(f *excelize.File) {
		style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &thousands})
		require.NoError(t, err)
		setRows(t, f, "A1",
			[]any{"Nama", "Jumlah"},
			[]any{"Baut", 1500},
			[]any{"Mur"},
		)
		require.NoError(t, f.SetCellStyle("Sheet1", "B2", "B2", style))
		require.NoError(t, f.MergeCell("Sheet1", "B2", "B3"))
	})
	got, err := ParseRFQ("rfq.xlsx", data)
	require.NoError(t, err)
	assert.Equal(t, []rfqRow{{Name: "Baut", Qty: 1500}, {Name: "Mur", Qty: 1500}}, got)
}

// Text that multiplies by reference.
func TestParseRFQ_TextExpansion(t *testing.T) {
	huge := strings.Repeat("x", 3<<20)
	cell := strings.Repeat("x", excelize.TotalCellChars)
	// shared swaps the "Baut" string's body.
	shared := func(body string, build func(f *excelize.File)) []byte {
		return patchPart(t, buildXLSX(t, build), "xl/sharedStrings.xml", `<si><t>Baut</t></si>`, `<si>`+body+`</si>`)
	}
	named := func(n int) func(f *excelize.File) {
		return func(f *excelize.File) {
			setRows(t, f, "A1", []any{"Nama"})
			for r := 2; r <= n+1; r++ {
				require.NoError(t, f.SetCellValue("Sheet1", fmt.Sprintf("A%d", r), "Baut"))
			}
		}
	}
	// spare puts the string outside every mapped column.
	spare := func(cols int) func(f *excelize.File) {
		return func(f *excelize.File) {
			setRows(t, f, "A1", []any{"Nama"}, append([]any{"Mur"}, slices.Repeat([]any{"Baut"}, cols)...))
		}
	}
	base, err := os.ReadFile(filepath.Join("testdata", "offset-table.xlsx"))
	require.NoError(t, err)
	extraRow := func(c string) []byte {
		return patchPart(t, base, "xl/worksheets/sheet1.xml", `</sheetData>`, `<row r="5">`+c+`</row></sheetData>`)
	}
	// Every column past the name reads string 2, "Baut".
	fullRow := func(data []byte) []byte {
		return patchPart(t, data, "xl/worksheets/sheet1.xml", `</sheetData>`,
			`<row r="3"><c r="B3" t="s"><v>2</v></c>`+strings.Repeat(`<c t="s"><v>2</v></c>`, excelize.MaxColumns-2)+`</row></sheetData>`)
	}
	wide := fullRow(shared("<t>"+cell+"</t>", spare(1)))
	// excelize folds part-name case, and the later table wins.
	twoTables := zipParts(t, fullRow(buildXLSX(t, spare(1))))
	twoTables["xl/sharedstrings.xml"] = strings.Replace(twoTables["xl/sharedStrings.xml"], `<t>Baut</t>`, `<t>`+cell+`</t>`, 1)
	// formatted styles one long string.
	formatted := func(code string) []byte {
		return shared("<t>"+cell+"</t>", func(f *excelize.File) {
			spare(1)(f)
			style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &code})
			require.NoError(t, err)
			require.NoError(t, f.SetCellStyle("Sheet1", "B2", "B2", style))
		})
	}
	cases := []struct {
		name string
		data []byte
	}{
		{name: "one shared string named by every row", data: shared("<t>"+huge+"</t>", named(300))},
		{name: "a merge repeating one cell down the sheet", data: shared("<t>"+huge+"</t>", func(f *excelize.File) {
			setRows(t, f, "A1", []any{"Nama"}, []any{"Baut"})
			require.NoError(t, f.MergeCell("Sheet1", "A2", "A4001"))
		})},
		{name: "a shared string over the cell limit", data: shared("<t>"+cell+"x</t>", spare(1))},
		{name: "a rich string whose runs pass the cell limit", data: shared(strings.Repeat("<r><t>"+cell+"</t></r>", 90), spare(1))},
		{name: "an inline string over the cell limit", data: extraRow(`<c r="A5" t="inlineStr"><is><t>` + cell + `x</t></is></c>`)},
		{name: "a value over the cell limit", data: extraRow(`<c r="A5" t="str"><v>` + cell + `x</v></c>`)},
		{name: "a long string in every spare column", data: shared("<t>"+cell+"</t>", func(f *excelize.File) {
			row := append([]any{"Mur"}, slices.Repeat([]any{"Baut"}, rfqMaxCols-1)...)
			setRows(t, f, "A1", append([][]any{{"Nama"}}, slices.Repeat([][]any{row}, 3)...)...)
		})},
		{name: "one long string across a full row", data: wide},
		{name: "one long string across a full row, strings first", data: partsSorted(t, wide)},
		{name: "one long string from a second table", data: zipOf(t, twoTables)},
		{name: "a text format repeating a long string", data: formatted("@@")},
		{name: "a text format with a zero placeholder", data: formatted("@0")},
		{name: "a format past Excel's length", data: formatted(`"` + strings.Repeat("x", 253) + `"@`)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			require.Less(t, len(c.data), rfqMaxBytes)
			start := time.Now()
			_, err := ParseRFQ("rfq.xlsx", c.data)
			require.ErrorIs(t, err, errRFQTooBig)
			assert.Less(t, time.Since(start), 5*time.Second)
		})
	}
}

// Non-cell text has no cap.
func TestParseRFQ_LongTextThatFits(t *testing.T) {
	cell := strings.Repeat("x", excelize.TotalCellChars)
	data := buildXLSX(t, func(f *excelize.File) {
		setRows(t, f, "A1", []any{"Nama", "Catatan"}, []any{"Baut", "catatan"})
		require.NoError(t, f.AddComment("Sheet1", excelize.Comment{Cell: "A2", Author: "a", Text: "komentar"}))
	})
	data = patchPart(t, data, "xl/sharedStrings.xml", `<t>catatan</t>`, `<t>`+cell+`</t>`)
	// Comments are not cell values, so their text has no cell limit.
	data = patchPart(t, data, "xl/comments1.xml", `<t>komentar</t>`, strings.Repeat(`<t>`+cell+`</t>`, 3))
	got, err := ParseRFQ("rfq.xlsx", data)
	require.NoError(t, err)
	assert.Equal(t, []rfqRow{{Name: "Baut"}}, got)
}

// Kept text fits the catalog.
func TestProducts_TextLimits(t *testing.T) {
	long := strings.Repeat("é", rfqMaxField)
	wide := strings.Repeat("𝔸", rfqMaxField)
	header := []string{"Kode", "Nama", "Satuan"}
	cases := []struct {
		name string
		rows [][]string
		err  error
	}{
		{name: "fields at the limit", rows: [][]string{header, {long, long, long}}},
		{name: "a name past the limit", rows: [][]string{header, {"", long + "x", ""}}, err: errRFQTooBig},
		{name: "a code past the limit", rows: [][]string{header, {long + "x", "Baut", ""}}, err: errRFQTooBig},
		{name: "a unit past the limit", rows: [][]string{header, {"", "Baut", long + "x"}}, err: errRFQTooBig},
		{name: "kept text past the budget", rows: append([][]string{header}, slices.Repeat([][]string{{"", wide, ""}}, rfqMaxUnzip/len(wide)+1)...), err: errRFQTooBig},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, _, err := gridRows(c.rows)
			if c.err != nil {
				require.ErrorIs(t, err, c.err)
				return
			}
			require.NoError(t, err)
		})
	}
}

// partsSorted rewrites parts by name.
// Shared strings then precede the sheet, the reverse of excelize's order.
func partsSorted(t *testing.T, data []byte) []byte {
	t.Helper()
	return zipOf(t, zipParts(t, data))
}

// zipParts reads every part.
func zipParts(t *testing.T, data []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	parts := map[string]string{}
	for _, zf := range zr.File {
		rc, err := zf.Open()
		require.NoError(t, err)
		body, err := io.ReadAll(rc)
		require.NoError(t, err)
		require.NoError(t, rc.Close())
		parts[zf.Name] = string(body)
	}
	return parts
}

// Formats and strings that fit.
func TestParseRFQ_TextThatFits(t *testing.T) {
	label := `"` + strings.Repeat("x", 252) + `"@`
	cases := []struct {
		name  string
		build func(f *excelize.File)
		want  []rfqRow
	}{
		{
			name: "a labelled text format",
			build: func(f *excelize.File) {
				code := `"Kode: "@`
				style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &code})
				require.NoError(t, err)
				setRows(t, f, "A1", []any{"Nama"}, []any{"Baut"})
				require.NoError(t, f.SetCellStyle("Sheet1", "A2", "A2", style))
			},
			want: []rfqRow{{Name: "Kode: Baut"}},
		},
		{
			name: "a format at Excel's length",
			build: func(f *excelize.File) {
				style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &label})
				require.NoError(t, err)
				setRows(t, f, "A1", []any{"Nama"}, []any{"Baut"})
				require.NoError(t, f.SetCellStyle("Sheet1", "A2", "A2", style))
			},
			want: []rfqRow{{Name: strings.Repeat("x", 252) + "Baut"}},
		},
		{
			name: "one placeholder per text section",
			build: func(f *excelize.File) {
				code := `@;@`
				style, err := f.NewStyle(&excelize.Style{CustomNumFmt: &code})
				require.NoError(t, err)
				setRows(t, f, "A1", []any{"Nama"}, []any{"Baut"})
				require.NoError(t, f.SetCellStyle("Sheet1", "A2", "A2", style))
			},
			want: []rfqRow{{Name: "Baut"}},
		},
		{
			name: "a long shared string on every row",
			build: func(f *excelize.File) {
				row := slices.Repeat([]any{strings.Repeat("x", 100)}, 10)
				setRows(t, f, "A1", append([][]any{{"Nama"}}, slices.Repeat([][]any{row}, 3000)...)...)
			},
			want: slices.Repeat([]rfqRow{{Name: strings.Repeat("x", 100)}}, 3000),
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data := partsSorted(t, buildXLSX(t, c.build))
			got, err := ParseRFQ("rfq.xlsx", data)
			require.NoError(t, err)
			assert.Equal(t, c.want, got)
		})
	}
}

// A product merged down is one product.
// Formatted RFQ forms often give each product two sheet rows by merging
// its cells downward; the merge fills every row, which must not read as a
// second request.
func TestParseRFQ_ProductMergedDown(t *testing.T) {
	cases := []struct {
		name   string
		rows   [][]any
		merges [][2]string
		want   []rfqRow
	}{
		{
			name: "every cell merged over two rows",
			rows: [][]any{
				{"1", "Baut M10", 20, "PCS"},
				{},
				{"2", "Mur M10", 30, "PCS"},
				{},
			},
			merges: [][2]string{
				{"A2", "A3"}, {"B2", "B3"}, {"C2", "C3"}, {"D2", "D3"},
				{"A4", "A5"}, {"B4", "B5"}, {"C4", "C5"}, {"D4", "D5"},
			},
			want: []rfqRow{
				{IMPACode: "1", Name: "Baut M10", Qty: 20, Unit: "PCS"},
				{IMPACode: "2", Name: "Mur M10", Qty: 30, Unit: "PCS"},
			},
		},
		{
			name: "a merge shared with another product keeps both",
			rows: [][]any{
				{"1", "Baut M10", 20, "PCS"},
				{"2", "Mur M10"},
			},
			merges: [][2]string{{"C2", "C3"}, {"D2", "D3"}},
			want: []rfqRow{
				{IMPACode: "1", Name: "Baut M10", Qty: 20, Unit: "PCS"},
				{IMPACode: "2", Name: "Mur M10", Qty: 20, Unit: "PCS"},
			},
		},
		{
			name: "three rows merged stay one product",
			rows: [][]any{
				{"1", "Kabel NYM 3x2.5", 100, "MTR"},
				{},
				{},
			},
			merges: [][2]string{{"A2", "A4"}, {"B2", "B4"}, {"C2", "C4"}, {"D2", "D4"}},
			want:   []rfqRow{{IMPACode: "1", Name: "Kabel NYM 3x2.5", Qty: 100, Unit: "MTR"}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			data := buildXLSX(t, func(f *excelize.File) {
				setRows(t, f, "A1", append([][]any{{"Kode", "Nama", "Jumlah", "Satuan"}}, c.rows...)...)
				for _, m := range c.merges {
					require.NoError(t, f.MergeCell("Sheet1", m[0], m[1]))
				}
			})
			got, err := ParseRFQ("rfq.xlsx", data)
			require.NoError(t, err)
			assert.Equal(t, c.want, got)
		})
	}
}
