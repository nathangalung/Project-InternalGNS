package invoices

import "context"

// PDF totals block test seam.
// exportData is unexported and testutil imports this package, so the
// integration assertions live in invoices_test and reach buildData here.
type PDFTotalsForTest struct {
	TotalProduk    string
	Diskon         string
	DPP            string
	LineNames      []string
	LineUnitPrices []string
	LineAmounts    []string
}

// Totals block as printed.
func (h *ExportHandler) PDFTotalsForTest(
	ctx context.Context, inv Invoice, items []InvoiceItem,
) PDFTotalsForTest {
	d := h.buildData(ctx, inv, items)
	out := PDFTotalsForTest{TotalProduk: d.TotalProduk, Diskon: d.Diskon, DPP: d.DPP}
	for _, it := range d.Items {
		out.LineNames = append(out.LineNames, it.Name)
		out.LineUnitPrices = append(out.LineUnitPrices, it.UnitPrice)
		out.LineAmounts = append(out.LineAmounts, it.Amount)
	}
	return out
}

// PDFHeaderForTest is the header.
type PDFHeaderForTest struct {
	VesselName, PONo, PODate, CompanyNPWP, InvoiceDate, DueDate string
}

// Header block as printed.
func (h *ExportHandler) PDFHeaderForTest(ctx context.Context, inv Invoice, items []InvoiceItem) PDFHeaderForTest {
	d := h.buildData(ctx, inv, items)
	return PDFHeaderForTest{
		VesselName: d.VesselName, PONo: d.PONo, PODate: d.PODate,
		CompanyNPWP: d.CompanyNPWP, InvoiceDate: d.InvoiceDate, DueDate: d.DueDate,
	}
}
