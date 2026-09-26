package purchaseorders_test

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Presign, attach, then download.
// The key the upload route issues is the one PATCH /file accepts, and
// the download hands back the original name.
func TestHandler_DocumentRoundTrip(t *testing.T) {
	_, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	base := fmt.Sprintf("/purchase-orders/%d", poID)

	res := doJSON(t, srv, http.MethodGet, base+"/download-url", nil)
	require.Equal(t, http.StatusNotFound, res.StatusCode)
	assert.Equal(t, "no file attached", readProblem(t, res).Detail)
	res.Body.Close()

	res = doJSON(t, srv, http.MethodGet, base+"/upload-url?fileName="+url.QueryEscape("Surat PO.pdf"), nil)
	require.Equal(t, http.StatusOK, res.StatusCode)
	var up struct {
		UploadURL string `json:"uploadUrl"`
		ObjectKey string `json:"objectKey"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	readJSON(t, res, &up)
	res.Body.Close()
	assert.True(t, strings.HasPrefix(up.ObjectKey, fmt.Sprintf("po/%d/", poID)), up.ObjectKey)
	assert.Contains(t, up.UploadURL, url.QueryEscape(up.ObjectKey))
	assert.Positive(t, up.ExpiresAt)

	res = doJSON(t, srv, http.MethodPatch, base+"/file", purchaseorders.UpdateFileRequest{
		FileName: " Surat PO.pdf ", FileSize: 2048, ObjectKey: " " + up.ObjectKey + " ",
	})
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	res.Body.Close()

	res = doJSON(t, srv, http.MethodGet, base, nil)
	var po purchaseorders.PurchaseOrder
	readJSON(t, res, &po)
	res.Body.Close()
	assert.Equal(t, purchaseorders.StatusUploaded, po.Status)
	require.NotNil(t, po.FileName)
	assert.Equal(t, "Surat PO.pdf", *po.FileName)
	require.NotNil(t, po.FileURL)
	assert.Equal(t, up.ObjectKey, *po.FileURL)

	res = doJSON(t, srv, http.MethodGet, base+"/download-url", nil)
	require.Equal(t, http.StatusOK, res.StatusCode)
	var down struct {
		DownloadURL string `json:"downloadUrl"`
		FileName    string `json:"fileName"`
	}
	readJSON(t, res, &down)
	res.Body.Close()
	assert.Contains(t, down.DownloadURL, url.QueryEscape(up.ObjectKey))
	assert.Equal(t, "Surat PO.pdf", down.FileName)
}

// Presign refuses what attach refuses.
func TestHandler_DocumentPresignRefusals(t *testing.T) {
	tests := []struct {
		name   string
		path   func(poID int64) string
		want   int
		detail string
		field  string
	}{
		{"bad id", func(int64) string { return "/purchase-orders/abc/upload-url?fileName=po.pdf" },
			http.StatusBadRequest, "invalid id", ""},
		{"unknown PO upload", func(int64) string { return "/purchase-orders/99999999/upload-url?fileName=po.pdf" },
			http.StatusNotFound, "purchase order not found", ""},
		{"unknown PO download", func(int64) string { return "/purchase-orders/99999999/download-url" },
			http.StatusNotFound, "purchase order not found", ""},
		{"no name", func(id int64) string { return fmt.Sprintf("/purchase-orders/%d/upload-url?fileName=%%20", id) },
			http.StatusUnprocessableEntity, "", "fileName"},
		{"executable", func(id int64) string { return fmt.Sprintf("/purchase-orders/%d/upload-url?fileName=po.exe", id) },
			http.StatusUnprocessableEntity, "", "fileName"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			res := doJSON(t, srv, http.MethodGet, tc.path(poID), nil)
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			p := readProblem(t, res)
			if tc.detail != "" {
				assert.Equal(t, tc.detail, p.Detail)
			}
			if tc.field != "" {
				assert.NotEmpty(t, p.Fields[tc.field])
			}
		})
	}
}

// Owner lookup failures are 500s.
func TestHandler_DocumentPresignFaults(t *testing.T) {
	srv := execServer(t, testutil.FakeExec{}, "")
	for _, path := range []string{"/purchase-orders/1/upload-url?fileName=po.pdf", "/purchase-orders/1/download-url"} {
		t.Run(path, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, path, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "internal server error", readProblem(t, res).Detail)
		})
	}
}
