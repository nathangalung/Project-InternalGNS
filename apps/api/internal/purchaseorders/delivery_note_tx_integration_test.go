package purchaseorders_test

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const seedContactID int64 = 1

// Header and goods only (PO-12).
// The note prints the header data and the goods, never the charge.
// CI has no xelatex, so there the render fails after the data is built
// and the route answers 500; the text checks need xelatex and pdftotext.
func TestDeliveryNote_PrintsGoodsNotTheShippingCharge(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	contact, vessel := seedContactID, "MV Samudra Jaya"
	addr, cost := "Dermaga Koja Utara", "50000"
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		ContactID:       &contact,
		VesselName:      &vessel,
		DiscountPct:     "0",
		ShippingAddress: &addr,
		ShippingCost:    &cost,
		Items: []quotations.CreateItem{{
			RequestedName: "Tali Tambang Nilon", Qty: "4", UnitID: seedUnitID, SellingPrice: "100000",
		}},
	})
	reachStatus(t, tx, poID, purchaseorders.StatusOnProgress)
	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	charge := shippingLine(t, items)
	require.NotEmpty(t, charge.ItemName, "the PO bills a named shipping charge")

	srv := execServer(t, tx, poTemplatesRoot(t))
	res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/delivery-note.pdf", poID), nil)
	defer res.Body.Close()
	if _, err := exec.LookPath("xelatex"); err != nil {
		require.Equal(t, http.StatusInternalServerError, res.StatusCode)
		t.Skip("xelatex not installed; the PDF body is not checked")
	}
	require.Equal(t, http.StatusOK, res.StatusCode)
	require.Equal(t, "application/pdf", res.Header.Get("Content-Type"))
	pdf, err := io.ReadAll(res.Body)
	require.NoError(t, err)

	text := pdfText(t, pdf)
	assert.Contains(t, text, "Tali Tambang Nilon")
	assert.Contains(t, text, vessel)
	assert.Contains(t, text, "Restu Umar Singgih", "Attn is the quotation contact")
	assert.NotContains(t, text, charge.ItemName, "the shipping charge is not a delivered line")
	// The goods line has no address of its own, so it prints the shipping
	// line's as its Tujuan, once, and no charge row repeats it.
	assert.Equal(t, 1, strings.Count(text, addr), "the goods line prints the shipping address")
}

// pdfText extracts the text layer.
// It skips the test without pdftotext.
func pdfText(t *testing.T, pdf []byte) string {
	t.Helper()
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext not installed; the PDF text is not checked")
	}
	path := filepath.Join(t.TempDir(), "note.pdf")
	require.NoError(t, os.WriteFile(path, pdf, 0o600))
	out, err := exec.Command(bin, "-layout", path, "-").Output()
	require.NoError(t, err)
	return string(out)
}

// Later failures are generic 500s.
// Each failure after the id parse hides its cause.
func TestDeliveryNote_Faults(t *testing.T) {
	tests := []struct {
		name      string
		exec      func(inner db.Executor) db.Executor
		templates func(t *testing.T) string
	}{
		{
			"reading the PO fails",
			func(db.Executor) db.Executor { return testutil.FakeExec{} },
			poTemplatesRoot,
		},
		{
			"reading the lines fails",
			func(inner db.Executor) db.Executor { return &testutil.CountingExec{Inner: inner, FailAfter: 1} },
			poTemplatesRoot,
		},
		{
			"the template is missing",
			func(inner db.Executor) db.Executor { return inner },
			func(t *testing.T) string { return t.TempDir() },
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx := testutil.BeginTx(t)
			_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
			srv := execServer(t, tc.exec(tx), tc.templates(t))

			res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/delivery-note.pdf", poID), nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "internal server error", readProblem(t, res).Detail)
		})
	}
}
