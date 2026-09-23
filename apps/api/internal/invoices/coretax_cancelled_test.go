package invoices_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A cancelled invoice is void: filing it would report a sale that did not
// happen, and next to its Pengganti it would report the sale twice.
func TestCoretaxExport_RefusesCancelledInvoice(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusCancelled), seedUserID))

	rec := exportCoretaxXML(t, tx, invID)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Contains(t, rec.Body.String(), "dibatalkan")
}

func TestCoretaxBulkExport_SkipsCancelledInvoice(t *testing.T) {
	cases := []struct {
		name      string
		cancel    bool
		wantFiled bool
	}{
		{name: "live invoice is filed", wantFiled: true},
		{name: "cancelled invoice is skipped", cancel: true, wantFiled: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			store := testutil.Store(t)
			repo := invoices.NewRepo(tx, store)
			if tc.cancel {
				require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusCancelled), seedUserID))
			}
			inv, err := repo.GetByID(ctx, invID)
			require.NoError(t, err)

			h := invoices.NewCoretaxHandler(repo, clients.NewRepo(tx, store), coretaxSettings, "../../templates/documents")
			req := httptest.NewRequest(http.MethodGet, "/invoices/coretax.xlsx?q="+url.QueryEscape(inv.InvoiceNo), nil)
			req = req.WithContext(context.Background())
			rec := httptest.NewRecorder()
			h.ExportBulkXLSX(rec, req)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

			f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
			require.NoError(t, err)
			rows, err := f.GetRows("DetailFaktur")
			require.NoError(t, err)
			filed := false
			for _, row := range rows {
				if strings.Contains(strings.Join(row, "|"), inv.InvoiceNo) {
					filed = true
				}
			}
			assert.Equal(t, tc.wantFiled, filed)
		})
	}
}
