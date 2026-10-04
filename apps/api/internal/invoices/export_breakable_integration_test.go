package invoices_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Long part numbers get breaks.
// A 60-character name with no space overflows its A5 cell unless the PDF
// line carries break points; short names print exactly as escaped.
func TestExport_LineNamesBreakLongTokens(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	part := "GNS" + strings.Repeat("7X4Q", 14) + "Z"
	require.Len(t, part, 60)
	items := []invoices.InvoiceItem{
		{LineType: "product", ItemName: part, Qty: "1", UnitPrice: "100000"},
		{LineType: "product", ItemName: "Tali_Tambang", Qty: "2", UnitPrice: "5000"},
	}

	got := newExportHandler(t, tx).PDFTotalsForTest(invoices.InvoiceDetail{}, items).LineNames

	assert.Equal(t, []string{pdfgen.LatexBreakable(part), `Tali\_Tambang`}, got)
}

// Long destinations get breaks.
// The Description cell prints the ship destination, which overflows its
// cell as one unbroken token unless the line carries break points.
func TestExport_LineDescriptionsBreakLongTokens(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	dest := "GUDANG" + strings.Repeat("TANJUNGPRIOK", 4) + "BLOKC7"
	short := "Deck & Hold #2"
	items := []invoices.InvoiceItem{
		{LineType: "product", ItemName: "Tali", Qty: "1", UnitPrice: "100000", ShipDestination: &dest},
		{LineType: "product", ItemName: "Cat", Qty: "2", UnitPrice: "5000", ShipDestination: &short},
		{LineType: "product", ItemName: "Lampu", Qty: "1", UnitPrice: "5000"},
	}

	got := newExportHandler(t, tx).PDFTotalsForTest(invoices.InvoiceDetail{}, items).LineDescriptions

	assert.Equal(t, []string{pdfgen.LatexBreakable(dest), `Deck \& Hold \#2`, ""}, got)
}

// Party fields get break points.
// The To and Address cells wrap, but one long unbroken token in the client
// name or address still overflows unless the text carries break points.
func TestExport_PartyBreaksLongTokens(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	name := "PT.GlobalMaritimeServicesIndonesia & Co"
	addr := "Komplek Pergudangan Jl.RayaCakung-Cilincing/Km.3-BlokC7 #12, Jakarta Utara"
	det := invoices.InvoiceDetail{Invoice: invoices.Invoice{CompanyName: name, CompanyAddress: &addr}}

	got := newExportHandler(t, tx).PDFHeaderForTest(det, nil)

	assert.Equal(t, pdfgen.LatexBreakable(name), got.CompanyName)
	assert.Equal(t, pdfgen.LatexBreakable(addr), got.CompanyAddress)
	assert.Contains(t, got.CompanyAddress, `\discretionary{}{}{}`, "the long token carries break points")
}
