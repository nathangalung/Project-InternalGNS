package invoices_test

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Invoice summary reads like the quotation.
// Total of every line, shipping included, the product discount with the
// percent derived from the stored snapshot, Sub Total, the PPN pair and
// Grand Total, with no HARGA TOTAL or bare DPP row.
func TestExport_PDF_SummaryRows(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	invID := discountedPOWithInvoice(t, tx)

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
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext not installed; the PDF text is not checked")
	}
	path := filepath.Join(t.TempDir(), "invoice.pdf")
	require.NoError(t, os.WriteFile(path, body, 0o600))
	out, err := exec.Command(bin, "-layout", path, "-").Output()
	require.NoError(t, err)
	text := strings.Join(strings.Fields(string(out)), " ")

	// 3 x 100.000 at 10 percent plus 50.000 shipping.
	rows := []string{
		"Total Rp350.000",
		"Diskon Produk 10% -Rp30.000",
		"Sub Total Rp320.000",
		"DPP Nilai Lain",
		"PPN 12%",
		"Grand Total",
	}
	at := 0
	for _, r := range rows {
		i := strings.Index(text[at:], r)
		if i < 0 {
			t.Fatalf("no %q after the previous row in: %s", r, text)
		}
		at += i + len(r)
	}
	for _, never := range []string{"HARGA TOTAL", "Pengiriman", "DPP Rp"} {
		assert.NotContains(t, text, never)
	}
}
