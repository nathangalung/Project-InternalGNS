package invoices_test

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Void and Pengganti are printed.
// A cancelled invoice still downloads, marked DIBATALKAN so it cannot pass
// as payable, and its Pengganti names the invoice it replaces.
func TestExport_PDF_MarksCancelledAndPengganti(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, oldID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	reason := "Salah alamat penagihan"
	require.NoError(t, repo.ChangeStatus(ctx, oldID, invoices.ChangeStatusRequest{
		Status: invoices.StatusCancelled, Note: &reason,
	}, seedUserID))
	pengganti, err := repo.Replace(ctx, oldID, seedUserID)
	require.NoError(t, err)
	old, err := repo.GetDetail(ctx, oldID)
	require.NoError(t, err)

	h := newExportHandler(t, tx)
	voided := h.PDFHeaderForTest(old, nil)
	assert.True(t, voided.Cancelled)
	assert.Empty(t, voided.ReplacesInvoiceNo)
	replacing := h.PDFHeaderForTest(pengganti, nil)
	assert.False(t, replacing.Cancelled)
	assert.Equal(t, pdfgen.LatexEscape(old.InvoiceNo), replacing.ReplacesInvoiceNo)

	srv := exportServer(t, tx, templatesRoot(t))
	render := func(id int64) string {
		t.Helper()
		res, err := srv.Client().Get(srv.URL + "/invoices/" + itoaInv(id) + "/pdf")
		require.NoError(t, err)
		defer res.Body.Close()
		body, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		if _, err := exec.LookPath("xelatex"); err != nil {
			t.Skip("xelatex not installed; the PDF text is not checked")
		}
		require.Equal(t, http.StatusOK, res.StatusCode, string(body))
		return invoicePDFText(t, body)
	}

	voidText := render(oldID)
	assert.Contains(t, voidText, "INVOICE DIBATALKAN")
	assert.NotContains(t, voidText, "Pengganti dari")

	penggantiText := render(pengganti.ID)
	assert.Contains(t, penggantiText, "Pengganti dari")
	assert.Contains(t, penggantiText, old.InvoiceNo)
	assert.NotContains(t, penggantiText, "DIBATALKAN")
}

// invoicePDFText extracts the text layer.
// It skips the test without pdftotext.
func invoicePDFText(t *testing.T, pdf []byte) string {
	t.Helper()
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext not installed; the PDF text is not checked")
	}
	path := filepath.Join(t.TempDir(), "invoice.pdf")
	require.NoError(t, os.WriteFile(path, pdf, 0o600))
	out, err := exec.Command(bin, path, "-").Output()
	require.NoError(t, err)
	return string(out)
}
