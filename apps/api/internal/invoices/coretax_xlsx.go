package invoices

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

const (
	coretaxSheetFaktur = "Faktur"
	coretaxSheetDetail = "DetailFaktur"
)

// Faktur headers, template row 3.
var coretaxFakturHeaders = []string{
	"Baris", "Tanggal Faktur", "Jenis Faktur", "Kode Transaksi",
	"Keterangan Tambahan", "Dokumen Pendukung", "Period Dok Pendukung",
	"Referensi", "Cap Fasilitas", "ID TKU Penjual", "NPWP/NIK Pembeli",
	"Jenis ID Pembeli", "Negara Pembeli", "Nomor Dokumen Pembeli",
	"Nama Pembeli", "Alamat Pembeli", "Email Pembeli", "ID TKU Pembeli",
}

// DetailFaktur headers, template row 1.
var coretaxDetailHeaders = []string{
	"Baris", "Barang/Jasa", "Kode Barang Jasa", "Nama Barang/Jasa",
	"Nama Satuan Ukur", "Harga Satuan", "Jumlah Barang Jasa", "Total Diskon",
	"DPP", "DPP Nilai Lain", "Tarif PPN", "PPN", "Tarif PPnBM", "PPnBM",
}

// coretaxEndMarker closes each sheet.
// The DJP converter reads column A down to it.
const coretaxEndMarker = "END"

// ExportBulkXLSX serves GET /invoices/coretax.xlsx.
// Every invoice matching the current list filter is written in the layout
// of the DJP bulk-import template, Faktur and DetailFaktur only.
func (h *CoretaxHandler) ExportBulkXLSX(w http.ResponseWriter, r *http.Request) {
	if h.settings.SellerTIN == "" || h.settings.SellerIDTKU == "" {
		httperr.Render(w, httperr.ServiceUnavailable("coretax seller identifiers not configured"))
		return
	}

	f := parseListFilter(r)
	f.Limit, f.Offset = listq.Unbounded, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "invoices.coretax_export", res.Total, len(res.Rows))

	// Two bulk reads, not two per invoice: the export is unbounded, so a
	// per-invoice round-trip would scale the whole request with the result set.
	invoiceIDs := make([]int64, 0, len(res.Rows))
	for _, inv := range res.Rows {
		invoiceIDs = append(invoiceIDs, inv.ID)
	}
	itemsByID, err := h.repo.ListItemsBulk(r.Context(), invoiceIDs)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	// Filter first, so a line-less invoice still never triggers a client read.
	invs := make([]Invoice, 0, len(res.Rows))
	clientIDs := make([]int64, 0, len(res.Rows))
	seenClient := make(map[int64]struct{}, len(res.Rows))
	for _, inv := range res.Rows {
		if len(itemsByID[inv.ID]) == 0 {
			continue // skip invoices with no lines
		}
		if inv.Status == StatusCancelled {
			continue // void; its Pengganti is filed instead
		}
		if !inv.PPNEnabled {
			continue // no PPN, no faktur pajak
		}
		if _, ok := seenClient[inv.CompanyClientID]; !ok {
			seenClient[inv.CompanyClientID] = struct{}{}
			clientIDs = append(clientIDs, inv.CompanyClientID)
		}
		invs = append(invs, inv)
	}

	clientsByID, err := h.clients.GetByIDs(r.Context(), clientIDs)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	// A bulk read returns fewer rows where GetByID returned ErrNotFound; keep
	// the old hard failure instead of exporting a blank buyer.
	for _, id := range clientIDs {
		if _, ok := clientsByID[id]; !ok {
			httperr.RenderDBErrCtx(r.Context(), w, clients.ErrNotFound)
			return
		}
	}

	// One refusal for the whole workbook: a half-filed bulk import is worse
	// than none, and the operator fixes every client in one pass.
	if refused := refusedBuyers(invs, clientsByID); len(refused) > 0 {
		p := refused.problem()
		httperr.RenderAs(w, p.Status, p)
		return
	}

	data, err := buildCoretaxWorkbook(h.settings, invs, itemsByID, clientsByID)
	if err != nil {
		httperr.Render(w, httperr.Internal("coretax workbook build failed"))
		return
	}
	httpx.WriteXLSX(w, "coretax-export", data)
}

// refusedBuyers lists refused invoices
func refusedBuyers(invs []Invoice, clientsByID map[int64]clients.Client) buyerRefusal {
	out := buyerRefusal{}
	for _, inv := range invs {
		c, ok := clientsByID[inv.CompanyClientID]
		if !ok {
			continue
		}
		buyer := invoiceBuyer(inv, c)
		missing := validateBuyerIdentity(buyer) != nil
		var reason RefusalReason
		switch {
		case !missing && !tkuMismatch(buyer):
			continue
		case inv.Status == StatusPaid:
			reason = ReasonPaid
		case missing:
			reason = ReasonNpwpMissing
		default:
			reason = ReasonTkuMismatch
		}
		out = append(out, CoretaxRefusal{
			InvoiceID: inv.ID, QuotationID: inv.QuotationID, InvoiceNo: inv.InvoiceNo,
			ClientID: inv.CompanyClientID, ClientName: inv.CompanyName, Reason: reason,
		})
	}
	return out
}

// buildCoretaxWorkbook writes the DJP layout.
// It is a pure function (no DB/HTTP) so it can be unit-tested without
// Postgres. The workbook holds only the two sheets the DJP converter reads,
// with every column as wide as its widest cell, so no value shows as ###.
func buildCoretaxWorkbook(
	settings deps.CoretaxSettings,
	invs []Invoice,
	itemsByID map[int64][]InvoiceItem,
	clientsByID map[int64]clients.Client,
) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	s, err := newCoretaxSheets(f)
	if err != nil {
		return nil, err
	}
	faktur := newSheetWriter(f, coretaxSheetFaktur)
	detail := newSheetWriter(f, coretaxSheetDetail)

	// Faktur sheet: NPWP header, then column headers at row 3.
	faktur.row(1, []any{"NPWP Penjual", nil, settings.SellerTIN}, s.cell)
	faktur.row(3, stringsToAny(coretaxFakturHeaders), s.head)
	// DetailFaktur sheet: column headers at row 1.
	detail.row(1, stringsToAny(coretaxDetailHeaders), s.head)

	fakturRow := 4 // first data row on Faktur
	detailRow := 2 // first data row on DetailFaktur
	for i, inv := range invs {
		tx := coretaxInvoiceFor(settings, inv, itemsByID[inv.ID], clientsByID[inv.CompanyClientID])

		buyerDocNo := tx.BuyerDocumentNo
		if buyerDocNo == "" {
			buyerDocNo = "-"
		}
		// DetailFaktur rows name their faktur by this Baris.
		baris := i + 1
		// Keterangan Tambahan, the supporting document and Cap Fasilitas
		// serve codes 07 and 08. The app records none, so they stay empty
		// cells as in the DJP template.
		faktur.row(fakturRow, []any{
			strconv.Itoa(baris), nil, tx.TaxInvoiceOpt, tx.TrxCode, nil,
			nil, nil, tx.RefDesc,
			nil, tx.SellerIDTKU, tx.BuyerTin,
			tx.BuyerDocument, tx.BuyerCountry, buyerDocNo, tx.BuyerName,
			tx.BuyerAdress, tx.BuyerEmail, tx.BuyerIDTKU,
		}, s.cell)
		// Column B carries the real invoice date with a date number format.
		faktur.date(fakturRow, 2, inv.InvoiceDate, s.date)
		fakturRow++

		for _, g := range tx.ListOfGoodSrv {
			detail.row(detailRow, []any{
				baris, g.Opt, g.Code, g.Name, g.Unit,
				num(g.Price), num(g.Qty), num(g.TotalDiscount), num(g.TaxBase),
				num(g.OtherTaxBase), num(g.VATRate), num(g.VAT),
				num(g.STLGRate), num(g.STLG),
			}, s.cell)
			detailRow++
		}
	}
	faktur.row(fakturRow, []any{coretaxEndMarker}, s.cell)
	detail.row(detailRow, []any{coretaxEndMarker}, s.cell)
	faktur.fitColumns()
	detail.fitColumns()

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return buf.Bytes(), nil
}

// coretaxStyles are the three cell styles.
type coretaxStyles struct{ head, cell, date int }

// newCoretaxSheets names both sheets and styles.
// Every written cell sits mid-row and headers are bold. NumFmt 14 is the
// DJP template's date format.
func newCoretaxSheets(f *excelize.File) (coretaxStyles, error) {
	middle := &excelize.Alignment{Vertical: "center"}
	var s coretaxStyles
	var errs [5]error
	errs[0] = f.SetSheetName(f.GetSheetName(0), coretaxSheetFaktur)
	_, errs[1] = f.NewSheet(coretaxSheetDetail)
	s.head, errs[2] = f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, Alignment: middle})
	s.cell, errs[3] = f.NewStyle(&excelize.Style{Alignment: middle})
	s.date, errs[4] = f.NewStyle(&excelize.Style{NumFmt: 14, Alignment: middle})
	if err := errors.Join(errs[:]...); err != nil {
		return s, fmt.Errorf("coretax sheets: %w", err)
	}
	return s, nil
}

// Column width bounds, in characters.
const (
	coretaxMinWidth = 8
	coretaxMaxWidth = 80
	// coretaxDateChars fits DD/MM/YYYY.
	coretaxDateChars = 10
)

// sheetWriter tracks widest cells.
type sheetWriter struct {
	f     *excelize.File
	sheet string
	width map[int]int
}

func newSheetWriter(f *excelize.File, sheet string) *sheetWriter {
	return &sheetWriter{f: f, sheet: sheet, width: map[int]int{}}
}

// row writes mixed row values.
// Nil entries are skipped, so an optional field stays a truly empty cell.
func (w *sheetWriter) row(row int, vals []any, style int) {
	for c, v := range vals {
		if v == nil {
			continue
		}
		cell, _ := excelize.CoordinatesToCellName(c+1, row)
		_ = w.f.SetCellValue(w.sheet, cell, v)
		_ = w.f.SetCellStyle(w.sheet, cell, cell, style)
		w.grow(c+1, utf8.RuneCountInString(cellText(v)))
	}
}

// date writes one date cell.
func (w *sheetWriter) date(row, col int, d time.Time, style int) {
	cell, _ := excelize.CoordinatesToCellName(col, row)
	_ = w.f.SetCellValue(w.sheet, cell, d)
	_ = w.f.SetCellStyle(w.sheet, cell, cell, style)
	w.grow(col, coretaxDateChars)
}

func (w *sheetWriter) grow(col, chars int) {
	w.width[col] = max(w.width[col], chars)
}

// fitColumns sizes each written column.
// Two characters of padding cover the bold header and Excel's cell margin.
func (w *sheetWriter) fitColumns() {
	for col, chars := range w.width {
		name, _ := excelize.ColumnNumberToName(col)
		width := float64(min(max(chars+2, coretaxMinWidth), coretaxMaxWidth))
		_ = w.f.SetColWidth(w.sheet, name, name, width)
	}
}

// cellText is the shown text.
func cellText(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return fmt.Sprint(x)
	}
}

func stringsToAny(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// num yields a numeric cell.
// It parses a normalized decimal string into a float, matching the
// template, and falls back to the raw string when unparseable.
func num(s string) any {
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return v
	}
	return s
}
