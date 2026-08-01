package invoices

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// coretaxTemplateRel is the DJP bulk-import workbook bundled with the image.
const coretaxTemplateRel = "coretax/coretax_export_2026.xlsx"

const (
	coretaxSheetFaktur = "Faktur"
	coretaxSheetDetail = "DetailFaktur"
)

// Faktur header columns, matching the DJP template row 3.
var coretaxFakturHeaders = []string{
	"Baris", "Tanggal Faktur", "Jenis Faktur", "Kode Transaksi",
	"Keterangan Tambahan", "Dokumen Pendukung", "Period Dok Pendukung",
	"Referensi", "Cap Fasilitas", "ID TKU Penjual", "NPWP/NIK Pembeli",
	"Jenis ID Pembeli", "Negara Pembeli", "Nomor Dokumen Pembeli",
	"Nama Pembeli", "Alamat Pembeli", "Email Pembeli", "ID TKU Pembeli",
}

// DetailFaktur header columns, matching the DJP template row 1.
var coretaxDetailHeaders = []string{
	"Baris", "Barang/Jasa", "Kode Barang Jasa", "Nama Barang/Jasa",
	"Nama Satuan Ukur", "Harga Satuan", "Jumlah Barang Jasa", "Total Diskon",
	"DPP", "DPP Nilai Lain", "Tarif PPN", "PPN", "Tarif PPnBM", "PPnBM",
	"Nomor Invoice",
}

// ExportBulkXLSX handles GET /invoices/coretax.xlsx — every invoice matching
// the current list filter, rendered into the DJP bulk-import template. NPWP
// header may be blank when the seller TIN is not configured.
func (h *CoretaxHandler) ExportBulkXLSX(w http.ResponseWriter, r *http.Request) {
	if h.templatesRoot == "" {
		httperr.Render(w, httperr.ServiceUnavailable("templates root not configured"))
		return
	}
	if h.settings.SellerTIN == "" || h.settings.SellerIDTKU == "" {
		httperr.Render(w, httperr.ServiceUnavailable("coretax seller identifiers not configured"))
		return
	}

	f := parseListFilter(r)
	f.Limit, f.Offset = exportMaxRows, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "invoices.coretax_export", res.Total, len(res.Rows))

	invs := make([]Invoice, 0, len(res.Rows))
	itemsByID := make(map[int64][]InvoiceItem, len(res.Rows))
	clientsByID := make(map[int64]clients.Client)
	for _, inv := range res.Rows {
		items, err := h.repo.ListItems(r.Context(), inv.ID)
		if err != nil {
			httperr.RenderDBErr(w, err)
			return
		}
		if len(items) == 0 {
			continue // skip invoices with no lines
		}
		if _, ok := clientsByID[inv.CompanyClientID]; !ok {
			c, err := h.clients.GetByID(r.Context(), inv.CompanyClientID)
			if err != nil {
				httperr.RenderDBErr(w, err)
				return
			}
			clientsByID[inv.CompanyClientID] = c
		}
		invs = append(invs, inv)
		itemsByID[inv.ID] = items
	}

	tmpl, err := os.ReadFile(filepath.Join(h.templatesRoot, coretaxTemplateRel))
	if err != nil {
		httperr.Render(w, httperr.Internal("coretax template unavailable"))
		return
	}

	data, err := buildCoretaxWorkbook(tmpl, h.settings, invs, itemsByID, clientsByID)
	if err != nil {
		httperr.Render(w, httperr.Internal("coretax workbook build failed"))
		return
	}
	httpx.WriteXLSX(w, "coretax-export", data)
}

// buildCoretaxWorkbook fills the DJP template with the given invoices. It is a
// pure function (no DB/HTTP) so it can be unit-tested without Postgres. It
// deletes the template's sample data sheets and recreates Faktur/DetailFaktur
// from scratch, leaving the REF and Keterangan sheets intact.
func buildCoretaxWorkbook(
	tmpl []byte,
	settings deps.CoretaxSettings,
	invs []Invoice,
	itemsByID map[int64][]InvoiceItem,
	clientsByID map[int64]clients.Client,
) ([]byte, error) {
	f, err := excelize.OpenReader(bytes.NewReader(tmpl))
	if err != nil {
		return nil, fmt.Errorf("open template: %w", err)
	}
	defer func() { _ = f.Close() }()

	// Drop the template's sample rows by recreating the two data sheets.
	if err := resetSheet(f, coretaxSheetFaktur); err != nil {
		return nil, err
	}
	if err := resetSheet(f, coretaxSheetDetail); err != nil {
		return nil, err
	}

	dateStyle, err := f.NewStyle(&excelize.Style{NumFmt: 17}) // dd-mmm-yy
	if err != nil {
		return nil, err
	}

	// Faktur sheet: NPWP header, then column headers at row 3.
	_ = f.SetCellStr(coretaxSheetFaktur, "A1", "NPWP Penjual")
	_ = f.SetCellStr(coretaxSheetFaktur, "C1", settings.SellerTIN)
	for c, head := range coretaxFakturHeaders {
		cell, _ := excelize.CoordinatesToCellName(c+1, 3)
		_ = f.SetCellStr(coretaxSheetFaktur, cell, head)
	}
	// DetailFaktur sheet: column headers at row 1.
	for c, head := range coretaxDetailHeaders {
		cell, _ := excelize.CoordinatesToCellName(c+1, 1)
		_ = f.SetCellStr(coretaxSheetDetail, cell, head)
	}

	fakturRow := 4 // first data row on Faktur
	detailRow := 2 // first data row on DetailFaktur
	for i, inv := range invs {
		tx := coretaxInvoiceFor(settings, inv, itemsByID[inv.ID], clientsByID[inv.CompanyClientID])

		buyerDocNo := tx.BuyerDocumentNo
		if buyerDocNo == "" {
			buyerDocNo = "-"
		}
		faktur := []any{
			i + 1, nil, tx.TaxInvoiceOpt, tx.TrxCode, tx.AddInfo, tx.CustomDoc,
			"", tx.RefDesc, tx.FacilityStamp, tx.SellerIDTKU, tx.BuyerTin,
			tx.BuyerDocument, tx.BuyerCountry, buyerDocNo, tx.BuyerName,
			tx.BuyerAdress, tx.BuyerEmail, tx.BuyerIDTKU,
		}
		writeRow(f, coretaxSheetFaktur, fakturRow, faktur)
		// Column B carries the real invoice date with a date number format.
		dateCell, _ := excelize.CoordinatesToCellName(2, fakturRow)
		_ = f.SetCellValue(coretaxSheetFaktur, dateCell, inv.InvoiceDate)
		_ = f.SetCellStyle(coretaxSheetFaktur, dateCell, dateCell, dateStyle)
		fakturRow++

		for j, g := range tx.ListOfGoodSrv {
			code := g.Code
			if code == "" {
				code = "000000"
			}
			detail := []any{
				j + 1, g.Opt, code, g.Name, g.Unit,
				num(g.Price), num(g.Qty), num(g.TotalDiscount), num(g.TaxBase),
				num(g.OtherTaxBase), num(g.VATRate), num(g.VAT),
				num(g.STLGRate), num(g.STLG), inv.InvoiceNo,
			}
			writeRow(f, coretaxSheetDetail, detailRow, detail)
			detailRow++
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return buf.Bytes(), nil
}

// resetSheet drops a sheet's sample rows by deleting and recreating it empty.
// The DJP importer keys on sheet name, not position, so the recreated sheet
// moving to the end of the tab order is harmless.
func resetSheet(f *excelize.File, name string) error {
	if err := f.DeleteSheet(name); err != nil {
		return fmt.Errorf("delete sheet %s: %w", name, err)
	}
	if _, err := f.NewSheet(name); err != nil {
		return fmt.Errorf("recreate sheet %s: %w", name, err)
	}
	return nil
}

// writeRow writes a row of mixed values; nil entries are skipped so the date
// cell can be set separately with its own format.
func writeRow(f *excelize.File, sheet string, row int, vals []any) {
	for c, v := range vals {
		if v == nil {
			continue
		}
		cell, _ := excelize.CoordinatesToCellName(c+1, row)
		_ = f.SetCellValue(sheet, cell, v)
	}
}

// num parses a normalized decimal string into a float so the cell is numeric,
// matching the template. Falls back to the raw string when unparseable.
func num(s string) any {
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return v
	}
	return s
}
