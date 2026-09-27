package quotations_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// rfqServer mounts the quotation routes.
// The upload reads no database.
func rfqServer(t *testing.T) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Mount("/quotations", quotations.Routes(deps.Deps{}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// rfqForm builds one multipart body.
func rfqForm(t *testing.T, field, name string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	require.NoError(t, mw.WriteField("catatan", "abaikan"))
	w, err := mw.CreateFormFile(field, name)
	require.NoError(t, err)
	_, err = w.Write(data)
	require.NoError(t, err)
	require.NoError(t, mw.Close())
	return &buf, mw.FormDataContentType()
}

type rfqProblem struct {
	Status int    `json:"status"`
	Detail string `json:"detail"`
}

func postRFQ(t *testing.T, srv *httptest.Server, body io.Reader, contentType string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/quotations/rfq", body)
	require.NoError(t, err)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return res.StatusCode, raw
}

func TestUploadRFQ_ReturnsRows(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "merged-cells.xlsx"))
	require.NoError(t, err)
	body, ct := rfqForm(t, "file", "permintaan.xlsx", data)
	status, raw := postRFQ(t, rfqServer(t), body, ct)
	require.Equal(t, http.StatusOK, status, string(raw))
	var got quotations.RFQRows
	require.NoError(t, json.Unmarshal(raw, &got))
	assert.Equal(t, []items.MatchRowInput{
		{IMPACode: "370115", Name: "Marine Radio", Qty: 2, Unit: "PCS"},
		{IMPACode: "210101", Name: "Tali Tambang", Qty: 5, Unit: "MTR"},
	}, got.Rows)
}

func TestUploadRFQ_Refusals(t *testing.T) {
	big := bytes.Repeat([]byte("x"), 1<<20+1)
	file := func(name, text string) func(t *testing.T) (io.Reader, string) {
		return func(t *testing.T) (io.Reader, string) {
			body, ct := rfqForm(t, "file", name, []byte(text))
			return body, ct
		}
	}
	cases := []struct {
		name   string
		body   func(t *testing.T) (io.Reader, string)
		status int
		detail string
	}{
		{
			name:   "a text file named .xlsx",
			body:   file("permintaan.xlsx", "Nama,Jumlah\nBaut,2\n"),
			status: http.StatusUnprocessableEntity,
			detail: "Format berkas tidak didukung",
		},
		{
			name:   "a PDF",
			body:   file("permintaan.pdf", "%PDF-1.7"),
			status: http.StatusUnprocessableEntity,
			detail: "Format berkas tidak didukung",
		},
		{
			name:   "an empty sheet",
			body:   file("permintaan.csv", ""),
			status: http.StatusUnprocessableEntity,
			detail: "Berkas kosong",
		},
		{
			name:   "no header row",
			body:   file("permintaan.csv", "a,b\n1,2\n"),
			status: http.StatusUnprocessableEntity,
			detail: "Baris judul kolom tidak ditemukan",
		},
		{
			name:   "a header without products",
			body:   file("permintaan.csv", "Nama,Jumlah\n"),
			status: http.StatusUnprocessableEntity,
			detail: "Tidak ada baris produk",
		},
		{
			name: "too many rows",
			body: file("permintaan.csv",
				"Nama\n"+strings.Repeat("Baut\n", 5000)),
			status: http.StatusUnprocessableEntity,
			detail: "Isi berkas terlalu besar",
		},
		{
			name: "a file over the limit",
			body: func(t *testing.T) (io.Reader, string) {
				body, ct := rfqForm(t, "file", "permintaan.xlsx", big)
				return body, ct
			},
			status: http.StatusRequestEntityTooLarge,
			detail: "melebihi batas 1 MB",
		},
		{
			name: "a body over the limit",
			body: func(t *testing.T) (io.Reader, string) {
				body, ct := rfqForm(t, "file", "permintaan.xlsx", bytes.Repeat(big, 2))
				return body, ct
			},
			status: http.StatusRequestEntityTooLarge,
			detail: "melebihi batas 1 MB",
		},
		{
			name: "a streamed field over the limit",
			body: func(t *testing.T) (io.Reader, string) {
				var buf bytes.Buffer
				mw := multipart.NewWriter(&buf)
				require.NoError(t, mw.WriteField("catatan", string(bytes.Repeat(big, 2))))
				require.NoError(t, mw.Close())
				// No length up front, so the body cap has to catch it.
				return io.MultiReader(&buf), mw.FormDataContentType()
			},
			status: http.StatusRequestEntityTooLarge,
			detail: "melebihi batas 1 MB",
		},
		{
			name: "no file part",
			body: func(t *testing.T) (io.Reader, string) {
				body, ct := rfqForm(t, "lampiran", "permintaan.xlsx", []byte("x"))
				return body, ct
			},
			status: http.StatusUnprocessableEntity,
			detail: "Pilih berkas permintaan",
		},
		{
			name: "not a multipart body",
			body: func(*testing.T) (io.Reader, string) {
				return strings.NewReader(`{"rows":[]}`), "application/json"
			},
			status: http.StatusUnprocessableEntity,
			detail: "Pilih berkas permintaan",
		},
		{
			name: "a truncated file part",
			body: func(*testing.T) (io.Reader, string) {
				return strings.NewReader("--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.xlsx\"\r\n\r\nabc"),
					"multipart/form-data; boundary=x"
			},
			status: http.StatusUnprocessableEntity,
			detail: "Pilih berkas permintaan",
		},
		{
			name: "a broken multipart body",
			body: func(*testing.T) (io.Reader, string) {
				return strings.NewReader("--x\r\nrusak"), "multipart/form-data; boundary=x"
			},
			status: http.StatusUnprocessableEntity,
			detail: "Pilih berkas permintaan",
		},
	}
	srv := rfqServer(t)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body, ct := c.body(t)
			status, raw := postRFQ(t, srv, body, ct)
			require.Equal(t, c.status, status, string(raw))
			var p rfqProblem
			require.NoError(t, json.Unmarshal(raw, &p))
			assert.Contains(t, p.Detail, c.detail)
		})
	}
}
