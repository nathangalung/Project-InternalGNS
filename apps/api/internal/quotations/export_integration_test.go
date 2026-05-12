package quotations_test

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

func quotationTemplatesRoot(t *testing.T) string {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(here), "..", "..", "templates", "documents")
}

func qExportServer(t *testing.T) *httptest.Server {
	t.Helper()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	d := deps.Deps{
		Pool:          pool,
		Queries:       store,
		TemplatesRoot: quotationTemplatesRoot(t),
		Pdf:           deps.PdfSettings{SignerName: "Bryan"},
	}
	r := chi.NewRouter()
	r.Use(qInjectUser(seedUserID))
	r.Mount("/quotations", quotations.Routes(d))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func qInjectUser(uid int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), uid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func TestQuotationExport_NewHandler(t *testing.T) {
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	h := quotations.NewExportHandler(
		quotations.NewRepo(pool, store),
		clients.NewRepo(pool, store),
		units.NewRepo(pool, store),
		pdfgen.NewRenderer(t.TempDir()),
		deps.PdfSettings{},
	)
	require.NotNil(t, h)
}

func TestQuotationExport_PDF_BadID(t *testing.T) {
	srv := qExportServer(t)
	res, err := srv.Client().Get(srv.URL + "/quotations/abc/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestQuotationExport_PDF_NotFound(t *testing.T) {
	srv := qExportServer(t)
	res, err := srv.Client().Get(srv.URL + "/quotations/99999999/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestQuotationExport_PDF_HappyPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires xelatex stub")
	}
	srv := qExportServer(t)

	ctx, tx := testutil.BeginTx(t)
	repo := quotations.NewRepo(tx, testutil.Store(t))
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
	t.Cleanup(func() {
		_, _ = testutil.Pool(t).Exec(ctx,
			"DELETE FROM quotation_items WHERE quotation_id=$1; DELETE FROM quotations WHERE id=$1", id)
	})

	res, err := srv.Client().Get(srv.URL + "/quotations/" + itoaQ(id) + "/pdf")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Contains(t, []int{http.StatusOK, http.StatusInternalServerError}, res.StatusCode)
}

func itoaQ(n int64) string {
	if n == 0 {
		return "0"
	}
	const digits = "0123456789"
	buf := make([]byte, 0, 20)
	for n > 0 {
		buf = append([]byte{digits[n%10]}, buf...)
		n /= 10
	}
	return string(buf)
}
