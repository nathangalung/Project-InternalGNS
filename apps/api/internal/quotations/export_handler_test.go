package quotations_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

// pdfExec picks executors per repo.
type pdfExec struct {
	quotes, clients, units quotations.Executor
	root                   string
}

func (p pdfExec) handler(t *testing.T) *quotations.ExportHandler {
	t.Helper()
	store := testutil.Store(t)
	return quotations.NewExportHandler(
		quotations.NewRepo(p.quotes, store),
		clients.NewRepo(p.clients, store),
		units.NewRepo(p.units, store),
		pdfgen.NewRenderer(p.root),
		deps.PdfSettings{SignerName: "Director"},
	)
}

// servePDF runs one export request.
func servePDF(h *quotations.ExportHandler, w http.ResponseWriter, id string) {
	r := chi.NewRouter()
	r.Get("/quotations/{id}/pdf", h.ExportPDF)
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/quotations/"+id+"/pdf", nil))
}

// createInTx adds a tx quotation.
func createInTx(t *testing.T) (context.Context, pgx.Tx, quotations.QuotationDetail) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	repo := quotations.NewRepo(tx, testutil.Store(t))
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	return ctx, tx, d
}

// Failing dependencies answer 500.
func TestQuotationExport_PDF_Failures(t *testing.T) {
	_, tx, d := createInTx(t)
	fake := testutil.FakeExec{}
	root := quotationTemplatesRoot(t)

	cases := []struct {
		name string
		exec pdfExec
	}{
		{"detail query fails", pdfExec{quotes: fake, clients: tx, units: tx, root: root}},
		{"units lookup fails", pdfExec{quotes: tx, clients: tx, units: fake, root: root}},
		{"contact lookup fails", pdfExec{quotes: tx, clients: fake, units: tx, root: root}},
		{"template missing", pdfExec{quotes: tx, clients: tx, units: tx, root: t.TempDir()}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			servePDF(c.exec.handler(t), rec, itoaQ(d.ID))
			assert.Equal(t, http.StatusInternalServerError, rec.Code)
			assert.Contains(t, rec.Header().Get("Content-Type"), "problem+json")
			assert.Contains(t, rec.Body.String(), `"detail":"internal server error"`)
		})
	}
}

func requireXelatex(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("xelatex"); err != nil {
		t.Skip("xelatex unavailable")
	}
}

func TestQuotationExport_PDF_Streams(t *testing.T) {
	requireXelatex(t)
	_, tx, d := createInTx(t)

	rec := httptest.NewRecorder()
	servePDF(pdfExec{quotes: tx, clients: tx, units: tx, root: quotationTemplatesRoot(t)}.handler(t), rec, itoaQ(d.ID))

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "application/pdf", rec.Header().Get("Content-Type"))
	assert.Equal(t,
		`attachment; filename="`+pdfgen.SanitizeFilename(d.QuotationNo)+`.pdf"`,
		rec.Header().Get("Content-Disposition"))
	assert.True(t, bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF-")), "the body is a PDF")
}

// failingWriter refuses the body.
type failingWriter struct {
	header http.Header
	status int
}

func (f *failingWriter) Header() http.Header       { return f.header }
func (f *failingWriter) WriteHeader(code int)      { f.status = code }
func (f *failingWriter) Write([]byte) (int, error) { return 0, errors.New("client went away") }

// Dropped connections are only logged.
func TestQuotationExport_PDF_WriteFailureIsLogged(t *testing.T) {
	requireXelatex(t)
	_, tx, d := createInTx(t)

	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	w := &failingWriter{header: http.Header{}}
	servePDF(pdfExec{quotes: tx, clients: tx, units: tx, root: quotationTemplatesRoot(t)}.handler(t), w, itoaQ(d.ID))

	assert.Equal(t, "application/pdf", w.header.Get("Content-Type"))
	assert.Zero(t, w.status, "no error status follows a started PDF")
	assert.Contains(t, logs.String(), "pdf write failed")
	assert.Contains(t, logs.String(), "client went away")
}

// ATTN describes one person.
// The details are the chosen contact's own, even once it is deactivated;
// without one, or when it is gone, none are printed, never another
// person's.
func TestExportHandler_ContactComm(t *testing.T) {
	ctx, tx, d := createInTx(t)
	contact := func(name, email, phone string, active bool) int64 {
		var id int64
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO company_contacts
			    (company_id, name, email, phone, country_code, is_active, created_by, updated_by)
			VALUES ($1, $2, $3, $4, 'IDN', $5, $6, $6)
			RETURNING id`, seedCompanyID, name, email, phone, active, seedUserID).Scan(&id))
		return id
	}
	active := contact("Kontak PDF", "kontak@kapal.example", "081211112222", true)
	inactive := contact("Kontak Lama", "lama@kapal.example", "081233334444", false)
	unknown := int64(987654321)

	cases := []struct {
		name      string
		contactID *int64
		wantEmail string
		wantPhone string
	}{
		{"no contact prints none", nil, "", ""},
		{"chosen contact", &active, "kontak@kapal.example", "081211112222"},
		{"deactivated contact keeps its details", &inactive, "lama@kapal.example", "081233334444"},
		{"missing contact prints none", &unknown, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := pdfExec{quotes: tx, clients: tx, units: tx}.handler(t)
			det := d
			det.ContactID = c.contactID
			gotEmail, gotPhone, err := h.ContactComm(ctx, det)
			require.NoError(t, err)
			assert.Equal(t, c.wantEmail, gotEmail)
			assert.Equal(t, c.wantPhone, gotPhone)
		})
	}

	t.Run("lookup fails", func(t *testing.T) {
		h := pdfExec{quotes: tx, clients: testutil.FakeExec{}, units: tx}.handler(t)
		det := d
		det.ContactID = &active
		_, _, err := h.ContactComm(ctx, det)
		assert.ErrorIs(t, err, testutil.ErrFake)
	})
}

// Quotations have their own signer.
// The quotation prints its signer under the scanned signature; the invoice
// signer, who signs by hand, never appears on it.
func TestQuotationExport_PDF_QuotationSigner(t *testing.T) {
	requireXelatex(t)
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext unavailable")
	}
	_, tx, d := createInTx(t)
	store := testutil.Store(t)
	h := quotations.NewExportHandler(
		quotations.NewRepo(tx, store), clients.NewRepo(tx, store), units.NewRepo(tx, store),
		pdfgen.NewRenderer(quotationTemplatesRoot(t)),
		deps.PdfSettings{SignerName: "Diah Arimurti", QuotationSignerName: "Seno Dwi Sasongko"},
	)
	rec := httptest.NewRecorder()
	servePDF(h, rec, itoaQ(d.ID))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	path := filepath.Join(t.TempDir(), "q.pdf")
	require.NoError(t, os.WriteFile(path, rec.Body.Bytes(), 0o600))
	out, err := exec.Command(bin, path, "-").Output()
	require.NoError(t, err)
	assert.Contains(t, string(out), "Seno Dwi Sasongko")
	assert.NotContains(t, string(out), "Diah Arimurti")
}
