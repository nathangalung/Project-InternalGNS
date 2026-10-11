package invoices_test

import (
	"io"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const advanceTerms = "Payment in Advance (Before Delivery)"

// deliverWithTerms invoices a quotation.
// The quotation carries the given payment terms; nil leaves them unset.
func deliverWithTerms(t *testing.T, tx pgx.Tx, terms *string) (int64, int64, int64) {
	t.Helper()
	return deliverQuotation(t, tx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		PaymentTerms:    terms,
		Items: []quotations.CreateItem{{
			RequestedName: "Terms Product", Qty: "1", UnitID: seedUnitID, SellingPrice: "100000",
		}},
	})
}

// dueAfter counts days to due.
func dueAfter(t *testing.T, det invoices.InvoiceDetail) int {
	t.Helper()
	require.NotNil(t, det.DueDate)
	for n := 0; n <= 400; n++ {
		if det.InvoiceDate.AddDate(0, 0, n).Format(time.DateOnly) == det.DueDate.Format(time.DateOnly) {
			return n
		}
	}
	t.Fatalf("due %s is not within 400 days of %s", det.DueDate, det.InvoiceDate)
	return 0
}

// Invoices take the quotation's terms.
// A day count sets the due date; any other terms are kept as written with
// the 30 day default, and blank terms are none.
func TestInvoice_PaymentTermsSnapshot(t *testing.T) {
	str := func(s string) *string { return &s }
	cases := []struct {
		name      string
		terms     *string
		wantTerms *string
		wantDays  int
	}{
		{"seven days", str("7 days"), str("7 days"), 7},
		{"one day", str("1 days"), str("1 days"), 1},
		{"net with a capital", str("Net 45 Days"), str("Net 45 Days"), 45},
		{"indonesian", str("14 hari"), str("14 hari"), 14},
		{"trimmed", str("  30 Days  "), str("30 Days"), 30},
		{"advance payment", str(advanceTerms), str(advanceTerms), 30},
		{"cash", str("TRANSFER - CASH"), str("TRANSFER - CASH"), 30},
		{"blank", str("   "), nil, 30},
		{"none", nil, nil, 30},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliverWithTerms(t, tx, tc.terms)
			det, err := invoices.NewRepo(tx, testutil.Store(t)).GetDetail(ctx, invID)
			require.NoError(t, err)
			assert.Equal(t, tc.wantTerms, det.PaymentTerms)
			assert.Equal(t, tc.wantDays, dueAfter(t, det))
		})
	}
}

// Pengganti takes the terms too.
// The replacement is dated on its own issue, so its due date runs from it.
func TestInvoice_PaymentTermsPengganti(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	terms := "7 days"
	_, _, oldID := deliverWithTerms(t, tx, &terms)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	reason := "Salah jatuh tempo"
	require.NoError(t, repo.ChangeStatus(ctx, oldID, invoices.ChangeStatusRequest{
		Status: invoices.StatusCancelled, Note: &reason,
	}, seedUserID))

	pengganti, err := repo.Replace(ctx, oldID, seedUserID)
	require.NoError(t, err)
	require.NotNil(t, pengganti.PaymentTerms)
	assert.Equal(t, terms, *pengganti.PaymentTerms)
	assert.Equal(t, 7, dueAfter(t, pengganti))
}

// The PDF prints invoice terms.
// An invoice issued before the snapshot has none and prints the configured
// terms it always printed.
func TestExport_PDF_PaymentTerms(t *testing.T) {
	cases := []struct {
		name, terms string
		clear       bool
		want        string
		absent      string
	}{
		{name: "the quotation's terms", terms: advanceTerms, want: advanceTerms, absent: "Net 30"},
		{name: "an older invoice", terms: "7 days", clear: true, want: "Net 30", absent: "7 days"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliverWithTerms(t, tx, &tc.terms)
			if tc.clear {
				_, err := tx.Exec(ctx, `UPDATE invoices SET payment_terms = NULL WHERE id = $1`, invID)
				require.NoError(t, err)
			}
			repo := invoices.NewRepo(tx, testutil.Store(t))
			det, err := repo.GetDetail(ctx, invID)
			require.NoError(t, err)
			h := invoices.NewExportHandler(repo, pdfgen.NewRenderer(t.TempDir()), exportSettings())
			assert.Equal(t, pdfgen.LatexEscape(tc.want), h.PDFHeaderForTest(det, nil).PaymentTerms)

			srv := exportServer(t, tx, templatesRoot(t))
			res, err := srv.Client().Get(srv.URL + "/invoices/" + itoaInv(invID) + "/pdf")
			require.NoError(t, err)
			defer res.Body.Close()
			body, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			if _, err := exec.LookPath("xelatex"); err != nil {
				t.Skip("xelatex not installed; the PDF text is not checked")
			}
			require.Equal(t, http.StatusOK, res.StatusCode, string(body))
			// A wrapped value reads as one line.
			text := strings.Join(strings.Fields(invoicePDFText(t, body)), " ")
			assert.Contains(t, text, tc.want)
			assert.NotContains(t, text, tc.absent)
		})
	}
}
