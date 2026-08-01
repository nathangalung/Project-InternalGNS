package invoices

import "context"

// Test seam for the PDF totals block.
// exportData is unexported and testutil imports this package, so the
// integration assertions live in invoices_test and reach buildData here.
type PDFTotalsForTest struct {
	TotalProduk    string
	Diskon         string
	DPP            string
	LineUnitPrices []string
	LineAmounts    []string
}

// Totals block as it will be printed.
func (h *ExportHandler) PDFTotalsForTest(
	ctx context.Context, inv Invoice, items []InvoiceItem,
) PDFTotalsForTest {
	d := h.buildData(ctx, inv, items)
	out := PDFTotalsForTest{TotalProduk: d.TotalProduk, Diskon: d.Diskon, DPP: d.DPP}
	for _, it := range d.Items {
		out.LineUnitPrices = append(out.LineUnitPrices, it.UnitPrice)
		out.LineAmounts = append(out.LineAmounts, it.Amount)
	}
	return out
}
