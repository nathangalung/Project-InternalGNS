package purchaseorders_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Party fields get break points.
// The To and Address cells wrap, but one long unbroken token in the client
// name or address still overflows unless the text carries break points.
func TestDeliveryNote_PartyBreaksLongTokens(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	name := "PT.GlobalMaritimeServicesIndonesia & Co"
	// Typed with a line break and a stray comma space.
	addr := "Komplek Pergudangan Jl.RayaCakung-Cilincing/Km.3-BlokC7 #12 ,\nJakarta Utara"
	_, err := tx.Exec(ctx, `UPDATE company_client SET address = $1 WHERE id = $2`, addr, seedCompanyID)
	require.NoError(t, err)
	store := testutil.Store(t)
	h := purchaseorders.NewDeliveryNoteHandler(
		purchaseorders.NewRepo(tx, store), clients.NewRepo(tx, store), pdfgen.NewRenderer(t.TempDir()),
	)

	gotName, gotAddr, err := h.PDFPartyForTest(ctx, purchaseorders.PurchaseOrder{CompanyClientID: seedCompanyID, CompanyName: name})
	require.NoError(t, err)

	assert.Equal(t, pdfgen.LatexBreakable(name), gotName)
	assert.Equal(t, pdfgen.LatexAddress(addr, pdfgen.PartyKeep), gotAddr)
	assert.Contains(t, gotAddr, `\#12, Jakarta~Utara`, "parts meet at one comma and a short part never splits")
	assert.Contains(t, gotAddr, `\discretionary{}{}{}`, "the long token carries break points")
}
