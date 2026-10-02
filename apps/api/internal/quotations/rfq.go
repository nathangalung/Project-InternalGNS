package quotations

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
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
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
	"github.com/xuri/nfp"
	"golang.org/x/net/html/charset"

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
// framing never trips that one first. Before excelize opens anything, the
// declared part sizes are held to the unzip cap and one XML pass holds
// each part to the row cap and the workbook to the merge and unit caps
// (xlsxBudget), which bound the memory a small file can expand into; each
// cell value is also held to Excel's character and number-format limits
// there, and the text excelize builds from shared strings to eight times
// the unzip cap: room for several sheets that each fill the kept-text cap
// (streamRows). The column cap only trims what each row keeps, and the
// field cap follows items.name (VARCHAR(500)), the widest catalog column
// a row can fill.
const (
	rfqMaxBytes   = 1 << 20
	rfqMaxUnzip   = 4 << 20
	rfqMaxRows    = 5000
	rfqMaxCols    = 64
	rfqMaxMerges  = 1000
	rfqMaxUnits   = 400_000
	rfqMaxField   = 500
	rfqMaxFmt     = 255
	rfqMaxText    = 8 * rfqMaxUnzip
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
	rfqNameKeys = []string{"nama", "produk", "name", "deskripsi", "description"}
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
	// above reports a cell filled by a merge from an earlier row.
	above func(row, col int) bool
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
		if rows, err := sc.try(s); err != nil || len(rows) > 0 {
			return rows, err
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

func (sc *rfqScan) try(s rfqSheet) ([]items.MatchRowInput, error) {
	if len(s.rows) == 0 {
		return nil, nil
	}
	sc.data = true
	rows, found, err := s.products()
	sc.header = sc.header || found
	return rows, err
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
		if rows, err := sc.try(s); err != nil || len(rows) > 0 {
			return rows, err
		}
	}
	return nil, sc.err()
}

// checkZip bounds the archive.
// Go's zip reader refuses a part that inflates past its declared size, so
// the declared sizes are a hard bound. Every part is then tallied against
// the row, merge and unit caps.
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
	b := xlsxBudget{refs: map[int]int{}}
	for _, zf := range zr.File {
		if err := b.scan(zf); err != nil {
			return err
		}
	}
	return b.checkShared()
}

// xlsxBudget tallies what excelize allocates.
// Loading a sheet builds one struct per element, pads the row list out to
// the highest row number and pads every row out to its last cell's column.
// Units count elements, padded cells and rows; each part is also held to
// the row cap by element count and by any row number it names.
type xlsxBudget struct {
	units, merges int
	// siLen is each shared string's length, the longest any part gives
	// that index: excelize folds part-name case and keeps the last of
	// several tables, so no one part is trusted to be the one it reads.
	siLen []int
	// refs counts the cells naming each index.
	refs map[int]int
}

// checkShared sums shared-string reads.
// excelize builds a fresh copy of a shared string for every cell naming
// it, so the lengths times their references bound that text.
func (b *xlsxBudget) checkShared() error {
	total := 0
	for i, n := range b.refs {
		if i >= 0 && i < len(b.siLen) {
			total += n * b.siLen[i]
		}
	}
	if total > rfqMaxText {
		return errRFQTooBig
	}
	return nil
}

// errRecorder keeps the reader's failure.
type errRecorder struct {
	r   io.Reader
	err error
}

func (e *errRecorder) Read(p []byte) (int, error) {
	n, err := e.r.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		e.err = err
	}
	return n, err
}

// scan tallies one zip part.
// Any part may hold a sheet, so every part is read as XML with excelize's
// charset handling. A part that stops parsing ends its tally there, since
// excelize stops no later; a broken archive is a format error.
func (b *xlsxBudget) scan(zf *zip.File) error {
	rc, err := zf.Open()
	if err != nil {
		return fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	defer func() { _ = rc.Close() }()
	src := &errRecorder{r: rc}
	d := xml.NewDecoder(src)
	d.CharsetReader = charset.NewReaderLabel
	var p partTally
	for {
		tok, err := d.RawToken()
		if err != nil {
			break
		}
		if err := b.add(&p, tok); err != nil {
			return err
		}
	}
	if src.err != nil {
		return fmt.Errorf("%w: %w", errRFQFormat, src.err)
	}
	return b.charge(p.rows + p.maxRow)
}

// partTally tracks one part's rows.
// It also sums the text of the current cell value: a shared or inline
// string item with every run inside it, or a <v> element.
type partTally struct {
	rows, maxRow, col, width int
	// item, inT and inV count open elements.
	item, inT, inV, text int
	// si counts the part's shared strings.
	si int
	// shared marks a shared-string cell; ref is its <v> text.
	shared bool
	ref    []byte
}

func (b *xlsxBudget) add(p *partTally, tok xml.Token) error {
	switch t := tok.(type) {
	case xml.CharData:
		return p.seeText(t)
	case xml.EndElement:
		b.closeText(p, t.Name.Local)
	case xml.StartElement:
		if err := b.charge(1); err != nil {
			return err
		}
		p.openText(t.Name.Local)
		switch t.Name.Local {
		case "numFmt":
			return checkNumFmt(attrOf(t, "formatCode"))
		case "mergeCell":
			if b.merges++; b.merges > rfqMaxMerges {
				return errRFQTooBig
			}
		case "row":
			if p.rows++; p.rows > rfqMaxRows {
				return errRFQTooBig
			}
			p.col, p.width = 0, 0
			if n, err := strconv.Atoi(attrOf(t, "r")); err == nil {
				return p.seeRow(n)
			}
		case "c":
			p.shared = attrOf(t, "t") == "s"
			p.col++
			if c, r, err := excelize.CellNameToCoordinates(attrOf(t, "r")); err == nil {
				p.col = max(p.col, c)
				if err := p.seeRow(r); err != nil {
					return err
				}
			}
			// Padding grows with the row's widest cell.
			grow := max(p.col-p.width, 0)
			p.width += grow
			return b.charge(grow)
		}
	}
	return nil
}

// openText enters a cell value.
// An item, or a <v> outside one, starts a new sum. Text elsewhere, such as
// a comment, is no cell value and is not counted.
func (p *partTally) openText(name string) {
	switch name {
	case "si", "is":
		if p.item == 0 {
			p.text = 0
		}
		p.item++
	case "v":
		if p.item == 0 {
			p.text = 0
		}
		p.inV++
		p.ref = p.ref[:0]
	case "t":
		p.inT++
	}
}

// closeText leaves an element.
// A closed shared string records its length and a shared-string cell's
// value its index, read as excelize reads it: a value that is no number
// names the first string. A stray end tag changes nothing.
func (b *xlsxBudget) closeText(p *partTally, name string) {
	switch name {
	case "si", "is":
		if p.item == 0 {
			return
		}
		if p.item--; p.item == 0 && name == "si" {
			if p.si == len(b.siLen) {
				b.siLen = append(b.siLen, p.text)
			} else {
				b.siLen[p.si] = max(b.siLen[p.si], p.text)
			}
			p.si++
		}
	case "v":
		p.inV = max(p.inV-1, 0)
		if p.shared && len(p.ref) > 0 {
			i, _ := strconv.Atoi(strings.TrimSpace(string(p.ref)))
			b.refs[i]++
		}
	case "t":
		p.inT = max(p.inT-1, 0)
	case "c":
		p.shared = false
	}
}

// seeText holds values to Excel's limit.
// excelize reads a shared string anew for every cell naming it, so one
// item past the cell limit multiplies before any sheet cap applies.
func (p *partTally) seeText(text []byte) error {
	if p.inV == 0 && (p.inT == 0 || p.item == 0) {
		return nil
	}
	if p.text += utf8.RuneCount(text); p.text > excelize.TotalCellChars {
		return errRFQTooBig
	}
	if p.shared && p.inV > 0 {
		p.ref = append(p.ref, text...)
	}
	return nil
}

// checkNumFmt bounds a number format.
// Excel caps a format at 255 characters. excelize's text section appends
// the cell text once per text or zero placeholder, so each text section
// may hold one.
func checkNumFmt(code string) error {
	if utf8.RuneCountInString(code) > rfqMaxFmt {
		return errRFQTooBig
	}
	p := nfp.NumberFormatParser()
	for _, s := range p.Parse(code) {
		if s.Type != nfp.TokenSectionText {
			continue
		}
		n := 0
		for _, tk := range s.Items {
			if tk.TType == nfp.TokenTypeTextPlaceHolder || tk.TType == nfp.TokenTypeZeroPlaceHolder {
				n++
			}
		}
		if n > 1 {
			return errRFQTooBig
		}
	}
	return nil
}

// seeRow checks a named row number.
// A number past the sheet's last row is malformed; excelize refuses it.
func (p *partTally) seeRow(n int) error {
	switch {
	case n > excelize.TotalRows:
		return nil
	case n > rfqMaxRows:
		return errRFQTooBig
	}
	p.maxRow = max(p.maxRow, n)
	return nil
}

func (b *xlsxBudget) charge(n int) error {
	if b.units += n; b.units > rfqMaxUnits {
		return errRFQTooBig
	}
	return nil
}

// attrOf reads as excelize does.
// encoding/xml matches any prefix and keeps the last duplicate, so this
// does too; reading the first would count a different cell than excelize
// loads.
func attrOf(e xml.StartElement, name string) string {
	v := ""
	for _, a := range e.Attr {
		if a.Name.Local == name {
			v = a.Value
		}
	}
	return v
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
	s.above = func(i, col int) bool {
		from, ok := src[[2]int{rowNums[i], col + 1}]
		return ok && from[0] < rowNums[i]
	}
	return s, nil
}

// streamRows reads the sheet rows.
// Keyed by sheet row number; only the leading columns are kept. checkZip
// already held the sheet to the row cap; the kept text is held to the
// unzip cap, since every cell reads its shared string anew.
func streamRows(f *excelize.File, name string) (map[int][]string, error) {
	it, err := f.Rows(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errRFQFormat, err)
	}
	defer func() { _ = it.Close() }()
	cells := map[int][]string{}
	kept := 0
	for n := 1; it.Next(); n++ {
		row, err := it.Columns()
		if err != nil {
			return nil, fmt.Errorf("%w: %w", errRFQFormat, err)
		}
		if len(row) == 0 {
			continue
		}
		row = row[:min(len(row), rfqMaxCols)]
		for _, v := range row {
			kept += len(v)
		}
		if kept > rfqMaxUnzip {
			return nil, errRFQTooBig
		}
		cells[n] = slices.Clone(row)
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
// found is false when no header row appears in the leading rows. A merge
// repeats one cell's text down the sheet, so each kept field is held to
// the catalog's name length and all of them together to the unzip cap.
func (s rfqSheet) products() ([]items.MatchRowInput, bool, error) {
	hdr, cols, found := findHeaderRow(s.rows)
	if !found {
		return nil, false, nil
	}
	out := []items.MatchRowInput{}
	kept := 0
	for i := hdr + 1; i < len(s.rows); i++ {
		row := s.rows[i]
		name := strings.TrimSpace(cellAt(row, cols.name))
		if s.continues(i, cols) {
			continue
		}
		if name == "" || s.isCategory(i, cols) {
			continue
		}
		r := items.MatchRowInput{
			IMPACode: strings.TrimSpace(cellAt(row, cols.impa)),
			Name:     name,
			Qty:      s.qty(i, cols.qty),
			Unit:     strings.TrimSpace(cellAt(row, cols.unit)),
		}
		for _, v := range []string{r.IMPACode, r.Name, r.Unit} {
			if kept += len(v); kept > rfqMaxUnzip || utf8.RuneCountInString(v) > rfqMaxField {
				return nil, true, errRFQTooBig
			}
		}
		out = append(out, r)
	}
	return out, true, nil
}

// continues spots a product's next row.
// Formatted forms give one product several rows by merging its cells down,
// and the merge fills every row. A row whose every filled column comes from
// a merge above repeats that product; one with any text of its own (a
// second product sharing a merged quantity) stays a row.
func (s rfqSheet) continues(i int, cols rfqColumns) bool {
	if s.above == nil {
		return false
	}
	filled := false
	for _, c := range []int{cols.impa, cols.name, cols.qty, cols.unit} {
		if c < 0 || strings.TrimSpace(cellAt(s.rows[i], c)) == "" {
			continue
		}
		if !s.above(i, c) {
			return false
		}
		filled = true
	}
	return filled
}

// isCategory spots a section row.
// A category such as DECK STORES is one merged cell running from the name
// column across another mapped column, not a product. A row with its own
// quantity outside every merge is a product whatever else is merged.
func (s rfqSheet) isCategory(i int, cols rfqColumns) bool {
	if cols.qty >= 0 && strings.TrimSpace(cellAt(s.rows[i], cols.qty)) != "" && !s.inSpan(i, cols.qty) {
		return false
	}
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

func (s rfqSheet) inSpan(i, col int) bool {
	return slices.ContainsFunc(s.spans[i], func(sp [2]int) bool { return col >= sp[0] && col <= sp[1] })
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
	errRFQTooBig: fmt.Sprintf("Isi berkas terlalu besar: paling banyak %d baris per lembar, %d sel gabungan, %d karakter per sel, "+
		"%d karakter untuk nama produk, kode IMPA, dan satuan, serta %d MB setelah diekstrak. "+
		"Format angka paling panjang %d karakter dengan satu tempat teks (@) per bagian. "+
		"Hapus baris, kolom, atau format yang tidak terpakai, dan perpendek teks yang terlalu panjang.",
		rfqMaxRows, rfqMaxMerges, excelize.TotalCellChars, rfqMaxField, rfqMaxUnzip>>20, rfqMaxFmt),
	errRFQEmpty:    "Berkas kosong: tidak ada sel yang berisi data.",
	errRFQNoHeader: fmt.Sprintf("Baris judul kolom tidak ditemukan. Pastikan kolom Nama Produk ada di %d baris pertama.", rfqHeaderScan),
	errRFQNoRows:   "Tidak ada baris produk di bawah judul kolom.",
}

// UploadRFQ parses an uploaded RFQ.
// POST /quotations/rfq takes multipart/form-data with the workbook in the
// "file" field. A file over the byte cap is a 413, as asset uploads are;
// every other refusal is a 422, including more product rows than
// items.MaxMatchRows, the batch the wizard sends on to match-rows.
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
	// The wizard matches the rows in one match-rows call.
	if len(rows) > items.MaxMatchRows {
		httperr.Render(w, httperr.UnprocessableDetail(fmt.Sprintf(
			"Berkas berisi %d baris produk; paling banyak %d per unggahan. Bagi berkas lalu unggah ulang.",
			len(rows), items.MaxMatchRows), nil))
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
