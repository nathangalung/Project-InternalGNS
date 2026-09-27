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
	ctx, tx := testutil.BeginTx(t)
	part := "GNS" + strings.Repeat("7X4Q", 14) + "Z"
	require.Len(t, part, 60)
	items := []invoices.InvoiceItem{
		{LineType: "product", ItemName: part, Qty: "1", UnitPrice: "100000"},
		{LineType: "product", ItemName: "Tali_Tambang", Qty: "2", UnitPrice: "5000"},
	}

	got := newExportHandler(t, tx).PDFTotalsForTest(ctx, invoices.Invoice{}, items).LineNames

	assert.Equal(t, []string{pdfgen.LatexBreakable(part), `Tali\_Tambang`}, got)
}
