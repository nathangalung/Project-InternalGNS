package quotations

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// RFQRows is a parsed RFQ upload.
// POST /quotations/rfq returns the rows /items/match-rows takes.
type RFQRows struct {
	Rows []items.MatchRowInput `json:"rows"`
}

// RFQ upload limits.
//
// The byte cap sits well under the router's 2 MB body limit so multipart
// framing never trips that one first. The unzip, row, column and merge caps
// bound what a small file can expand into: the declared part sizes are
// checked before excelize opens anything, rows are counted while the sheet
// streams, and each row keeps only its leading columns.
const (
	rfqMaxBytes   = 1 << 20
	rfqMaxUnzip   = 16 << 20
	rfqMaxRows    = 5000
	rfqMaxCols    = 64
	rfqMaxMerges  = 1000
	rfqHeaderScan = 15
	// rfqFormSlack covers multipart framing.
	rfqFormSlack = 64 << 10
)

var (
	errRFQMissing  = errors.New("rfq: no file part")
	errRFQFormat   = errors.New("rfq: unsupported file")
	errRFQTooLarge = errors.New("rfq: file over the byte limit")
	errRFQTooBig   = errors.New("rfq: sheet over the size limits")
	errRFQEmpty    = errors.New("rfq: no data")
	errRFQNoHeader = errors.New("rfq: no header row")
	errRFQNoRows   = errors.New("rfq: no product rows")
)

// Header keys per column.
// Matched case-insensitively, exact first, then as a substring.
var (
	rfqImpaKeys = []string{"impa", "kode impa", "kode"}
	rfqNameKeys = []string{"nama", "produk", "name", "deskripsi"}
	rfqQtyKeys  = []string{"kuantitas", "jumlah", "qty", "quantity"}
	rfqUnitKeys = []string{"satuan", "unit"}
)

// rfqColumns holds mapped column indexes.
type rfqColumns struct {
	impa, name, qty, unit int
}

// rfqSheet is one sheet's text grid.
type rfqSheet struct {
	rows [][]string
	// spans lists the multi-column merges crossing each row.
	spans map[int][][2]int
	// num reads a numeric cell's stored value.
	num func(row, col int) (float64, bool)
}

// textSheet wraps a plain grid.
func textSheet(rows [][]string) rfqSheet {
	return rfqSheet{rows: rows}
}

// ParseRFQ reads product rows.
// The file type follows the extension: .xlsx or .csv, in any case. The
// first sheet that yields product rows wins.
func ParseRFQ(name string, data []byte) ([]items.MatchRowInput, error) {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".csv":
		s, err := csvSheet(data)
		if err != nil {
			return nil, err
		}
		var sc rfqScan
		if rows := sc.try(s); len(rows) > 0 {
			return rows, nil
		}
		return nil, sc.err()
	case ".xlsx":
		return parseXLSX(data)
	default:
		return nil, errRFQFormat
	}
}

// rfqScan tracks why nothing matched.
type rfqScan struct {
	data, header bool
}

func (sc *rfqScan) try(s rfqSheet) []items.MatchRowInput {
	if len(s.rows) == 0 {
		return nil
	}
	sc.data = true
	rows, found := s.products()
	sc.header = sc.header || found
	return rows
}

func (sc rfqScan) err() error {
	switch {
	case sc.header:
		return errRFQNoRows
	case sc.data:
		return errRFQNoHeader
	default:
		return errRFQEmpty
	}
}

// csvSheet reads RFC 4180 text.
// A leading BOM is dropped, rows may be ragged, and a bare quote inside a
// field (an inch mark) is kept as text.
func csvSheet(data []byte) (rfqSheet, error) {
	r := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\ufeff"))))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	var rows [][]string
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return rfqSheet{}, fmt.Errorf("%w: %w", errRFQFormat, err)
		}
		if !slices.ContainsFunc(rec, func(c string) bool { return c != "" }) {
			continue
		}
		if len(rows) == rfqMaxRows {
			return rfqSheet{}, errRFQTooBig
		}
		rows = append(rows, rec[:min(len(rec), rfqMaxCols)])
	}
	return textSheet(rows), nil
}

// parseXLSX reads every sheet in order.
func parseXLSX(data []byte) ([]items.MatchRowInput, error) {
	if err := checkZip(data); err != nil {
		return nil, err
	}
	f, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{
		UnzipSizeLimit:    rfqMaxUnzip,
		UnzipXMLSizeLimit: rfqMaxUnzip,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	defer func() { _ = f.Close() }()
	names := f.GetSheetList()
	if len(names) == 0 {
		return nil, errRFQFormat
	}
	var sc rfqScan
	for _, name := range names {
		s, err := readSheet(f, name)
		if err != nil {
			return nil, err
		}
		if rows := sc.try(s); len(rows) > 0 {
			return rows, nil
		}
	}
	return nil, sc.err()
}

// checkZip bounds the archive.
// Go's zip reader refuses a part that inflates past its declared size, so
// the declared sizes are a hard bound. Each "mergeCell" in any part counts
// toward the merge cap, an upper bound on what excelize will load.
func checkZip(data []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	var total uint64
	for _, zf := range zr.File {
		if zf.UncompressedSize64 > rfqMaxUnzip-total {
			return errRFQTooBig
		}
		total += zf.UncompressedSize64
	}
	merges := 0
	for _, zf := range zr.File {
		n, err := countMerges(zf)
		if err != nil {
			return fmt.Errorf("%w: %w", errRFQFormat, err)
		}
		if merges += n; merges > rfqMaxMerges {
			return errRFQTooBig
		}
	}
	return nil
}

func countMerges(zf *zip.File) (int, error) {
	rc, err := zf.Open()
	if err != nil {
		return 0, err
	}
	defer func() { _ = rc.Close() }()
	body, err := io.ReadAll(rc)
	if err != nil {
		return 0, err
	}
	return bytes.Count(body, []byte("mergeCell")), nil
}

// readSheet builds one sheet's grid.
// Cells read as displayed (number formats applied), error cells read blank,
// and a merged range repeats its top-left value over every cell it covers.
// Rows without any cell are dropped, so the header scan counts only rows
// that hold something.
func readSheet(f *excelize.File, name string) (rfqSheet, error) {
	cells, err := streamRows(f, name)
	if err != nil {
		return rfqSheet{}, err
	}
	blankErrors(f, name, cells)
	src, spanAt, err := fillMerges(f, name, cells)
	if err != nil {
		return rfqSheet{}, err
	}
	rowNums := slices.Sorted(maps.Keys(cells))
	s := rfqSheet{rows: make([][]string, len(rowNums)), spans: map[int][][2]int{}}
	for i, r := range rowNums {
		s.rows[i] = cells[r]
		if sp := spanAt[r]; len(sp) > 0 {
			s.spans[i] = sp
		}
	}
	s.num = func(i, col int) (float64, bool) {
		at := [2]int{rowNums[i], col + 1}
		if from, ok := src[at]; ok {
			at = from
		}
		return numericCell(f, name, at)
	}
	return s, nil
}

// streamRows reads capped rows.
// Keyed by sheet row number; only the leading columns are kept.
func streamRows(f *excelize.File, name string) (map[int][]string, error) {
	it, err := f.Rows(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	defer func() { _ = it.Close() }()
	cells := map[int][]string{}
	for n := 1; it.Next(); n++ {
		row, err := it.Columns()
		if err != nil {
			return nil, fmt.Errorf("%w: %w", errRFQFormat, err)
		}
		if len(row) == 0 {
			continue
		}
		if len(cells) == rfqMaxRows {
			return nil, errRFQTooBig
		}
		cells[n] = slices.Clone(row[:min(len(row), rfqMaxCols)])
	}
	if err := it.Error(); err != nil {
		return nil, fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	return cells, nil
}

// blankErrors clears error cells.
// An error such as #N/A reads as its literal text; only cells that look
// like one are checked against their stored type.
func blankErrors(f *excelize.File, name string, cells map[int][]string) {
	for r, row := range cells {
		for c, v := range row {
			if !strings.HasPrefix(v, "#") {
				continue
			}
			if typ, err := f.GetCellType(name, cellRef(r, c+1)); err == nil && typ == excelize.CellTypeError {
				row[c] = ""
			}
		}
	}
}

// fillMerges repeats merged values.
// It returns each filled cell's top-left source and, per sheet row, the
// multi-column spans that cross it. The fill is capped at one full grid of
// cells, so overlapping or oversized ranges cannot run away.
func fillMerges(f *excelize.File, name string, cells map[int][]string) (map[[2]int][2]int, map[int][][2]int, error) {
	mcs, err := f.GetMergeCells(name, true)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	src := map[[2]int][2]int{}
	spans := map[int][][2]int{}
	budget := rfqMaxRows * rfqMaxCols
	for _, mc := range mcs {
		c1, r1, errStart := excelize.CellNameToCoordinates(mc.GetStartAxis())
		c2, r2, errEnd := excelize.CellNameToCoordinates(mc.GetEndAxis())
		if err := errors.Join(errStart, errEnd); err != nil {
			return nil, nil, fmt.Errorf("%w: %w", errRFQFormat, err)
		}
		v := cellAt(cells[r1], c1-1)
		if c1 > rfqMaxCols || v == "" {
			continue
		}
		c2 = min(c2, rfqMaxCols)
		for r := r1; r <= r2; r++ {
			if c2 > c1 {
				spans[r] = append(spans[r], [2]int{c1 - 1, c2 - 1})
			}
			for c := c1; c <= c2; c++ {
				if r == r1 && c == c1 {
					continue
				}
				if budget--; budget < 0 {
					return nil, nil, errRFQTooBig
				}
				row := cells[r]
				if len(row) < c {
					row = append(row, make([]string, c-len(row))...)
				}
				row[c-1] = v
				cells[r] = row
				src[[2]int{r, c}] = [2]int{r1, c1}
			}
		}
		if len(cells) > rfqMaxRows {
			return nil, nil, errRFQTooBig
		}
	}
	return src, spans, nil
}

// numericCell reads a stored number.
// Only number cells qualify: their displayed text may carry a thousands
// format that the id-ID text rule would misread.
func numericCell(f *excelize.File, name string, at [2]int) (float64, bool) {
	ref := cellRef(at[0], at[1])
	typ, err := f.GetCellType(name, ref)
	if err != nil || (typ != excelize.CellTypeUnset && typ != excelize.CellTypeNumber) {
		return 0, false
	}
	// The type read just succeeded, so the same cell reads too.
	raw, _ := f.GetCellValue(name, ref, excelize.Options{RawCellValue: true})
	return numericQty(raw)
}

// numericQty parses a stored number.
func numericQty(raw string) (float64, bool) {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsInf(v, 0) || math.IsNaN(v) {
		return 0, false
	}
	return v, true
}

// parseQtyText reads id-ID quantity text.
// A dot before exactly three digits is a thousands separator and the first
// comma is the decimal mark; anything unreadable is zero.
func parseQtyText(s string) float64 {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '.' && thousandsGroup(s[i+1:]) {
			continue
		}
		b.WriteByte(s[i])
	}
	v, ok := numericQty(strings.Replace(b.String(), ",", ".", 1))
	if !ok {
		return 0
	}
	return v
}

// thousandsGroup: three digits, then no digit.
func thousandsGroup(s string) bool {
	if len(s) < 3 {
		return false
	}
	for i := range 3 {
		if !isDigit(s[i]) {
			return false
		}
	}
	return len(s) == 3 || !isDigit(s[3])
}

// cellRef names a sheet cell.
// Row and column come from the sheet itself, so they are always in range.
func cellRef(row, col int) string {
	ref, _ := excelize.CoordinatesToCellName(col, row)
	return ref
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

func cellAt(row []string, c int) string {
	if c < 0 || c >= len(row) {
		return ""
	}
	return row[c]
}

// products maps rows under the header.
// found is false when no header row appears in the leading rows.
func (s rfqSheet) products() ([]items.MatchRowInput, bool) {
	hdr, cols, found := findHeaderRow(s.rows)
	if !found {
		return nil, false
	}
	out := []items.MatchRowInput{}
	for i := hdr + 1; i < len(s.rows); i++ {
		row := s.rows[i]
		name := strings.TrimSpace(cellAt(row, cols.name))
		if name == "" || s.isCategory(i, cols) {
			continue
		}
		out = append(out, items.MatchRowInput{
			IMPACode: strings.TrimSpace(cellAt(row, cols.impa)),
			Name:     name,
			Qty:      s.qty(i, cols.qty),
			Unit:     strings.TrimSpace(cellAt(row, cols.unit)),
		})
	}
	return out, true
}

// isCategory spots a section row.
// A category such as DECK STORES is one merged cell running from the name
// column across another mapped column, not a product.
func (s rfqSheet) isCategory(i int, cols rfqColumns) bool {
	for _, sp := range s.spans[i] {
		if cols.name < sp[0] || cols.name > sp[1] {
			continue
		}
		for _, c := range []int{cols.impa, cols.qty, cols.unit} {
			if c >= 0 && c >= sp[0] && c <= sp[1] {
				return true
			}
		}
	}
	return false
}

func (s rfqSheet) qty(i, col int) float64 {
	if col < 0 {
		return 0
	}
	if s.num != nil {
		if v, ok := s.num(i, col); ok {
			return v
		}
	}
	return parseQtyText(cellAt(s.rows[i], col))
}

// findHeaderRow picks the richest header.
// Among the leading rows, the one mapping the most columns wins; the name
// column is required and the first row wins a tie.
func findHeaderRow(rows [][]string) (int, rfqColumns, bool) {
	best, bestScore := -1, 0
	var bestCols rfqColumns
	for r := range min(len(rows), rfqHeaderScan) {
		norm := make([]string, len(rows[r]))
		for i, h := range rows[r] {
			norm[i] = strings.ToLower(strings.TrimSpace(h))
		}
		cols := rfqColumns{
			impa: findColumn(norm, rfqImpaKeys),
			name: findColumn(norm, rfqNameKeys),
			qty:  findColumn(norm, rfqQtyKeys),
			unit: findColumn(norm, rfqUnitKeys),
		}
		if cols.name < 0 {
			continue
		}
		score := 0
		for _, c := range []int{cols.impa, cols.name, cols.qty, cols.unit} {
			if c >= 0 {
				score++
			}
		}
		if score > bestScore {
			best, bestScore, bestCols = r, score, cols
		}
	}
	return best, bestCols, best >= 0
}

// findColumn: exact key, then substring.
func findColumn(headers, keys []string) int {
	for _, k := range keys {
		if i := slices.Index(headers, k); i >= 0 {
			return i
		}
	}
	for _, k := range keys {
		if i := slices.IndexFunc(headers, func(h string) bool { return strings.Contains(h, k) }); i >= 0 {
			return i
		}
	}
	return -1
}

// Problem details per refusal.
var rfqDetails = map[error]string{
	errRFQMissing: "Pilih berkas permintaan (.xlsx atau .csv) untuk diunggah.",
	errRFQFormat:  "Format berkas tidak didukung. Gunakan .xlsx atau .csv (simpan ulang file .xls sebagai .xlsx).",
	errRFQTooBig: fmt.Sprintf("Isi berkas terlalu besar: paling banyak %d baris, %d sel gabungan, dan %d MB setelah diekstrak.",
		rfqMaxRows, rfqMaxMerges, rfqMaxUnzip>>20),
	errRFQEmpty:    "Berkas kosong: tidak ada sel yang berisi data.",
	errRFQNoHeader: fmt.Sprintf("Baris judul kolom tidak ditemukan. Pastikan kolom Nama Produk ada di %d baris pertama.", rfqHeaderScan),
	errRFQNoRows:   "Tidak ada baris produk di bawah judul kolom.",
}

// UploadRFQ parses an uploaded RFQ.
// POST /quotations/rfq takes multipart/form-data with the workbook in the
// "file" field. A file over the byte cap is a 413, as asset uploads are;
// every other refusal is a 422.
func (h *Handler) UploadRFQ(w http.ResponseWriter, r *http.Request) {
	const limit = rfqMaxBytes + rfqFormSlack
	if r.ContentLength > limit {
		renderRFQErr(w, errRFQTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	name, data, err := readRFQFile(r)
	if err != nil {
		renderRFQErr(w, err)
		return
	}
	rows, err := ParseRFQ(name, data)
	if err != nil {
		renderRFQErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, RFQRows{Rows: rows})
}

// readRFQFile reads the file part.
// Parts stream, so nothing spills to disk and other fields are skipped.
func readRFQFile(r *http.Request) (string, []byte, error) {
	mr, err := r.MultipartReader()
	if err != nil {
		return "", nil, fmt.Errorf("%w: %w", errRFQMissing, err)
	}
	for {
		p, err := mr.NextPart()
		if err != nil {
			return "", nil, rfqReadErr(err)
		}
		if p.FormName() != "file" {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(p, rfqMaxBytes+1))
		if err != nil {
			return "", nil, rfqReadErr(err)
		}
		if len(data) > rfqMaxBytes {
			return "", nil, errRFQTooLarge
		}
		return p.FileName(), data, nil
	}
}

// rfqReadErr sorts a body read failure.
func rfqReadErr(err error) error {
	if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
		return errRFQTooLarge
	}
	return fmt.Errorf("%w: %w", errRFQMissing, err)
}

func renderRFQErr(w http.ResponseWriter, err error) {
	if errors.Is(err, errRFQTooLarge) {
		httperr.Render(w, httperr.PayloadTooLarge(fmt.Sprintf(
			"Ukuran berkas melebihi batas %d MB. Pilih berkas yang lebih kecil.", rfqMaxBytes>>20)))
		return
	}
	detail := rfqDetails[errRFQFormat]
	for sentinel, d := range rfqDetails {
		if errors.Is(err, sentinel) {
			detail = d
			break
		}
	}
	httperr.Render(w, httperr.UnprocessableDetail(detail, nil))
}
