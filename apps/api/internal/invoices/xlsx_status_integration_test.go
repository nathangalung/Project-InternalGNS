package invoices_test

import (
	"bytes"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Sheet prints the shown status.
// An invoice past its due date is Terlambat on screen and in the tiles, so
// the export must not print the stored "sent" key.
func TestExportXLSX_EffectiveStatusLabel(t *testing.T) {
	cases := []struct {
		status  string
		dueDays int
		want    string
	}{
		{"sent", -1, "Terlambat"},
		{"sent", 5, "Dikirim"},
		{"draft", 5, "Draf"},
	}
	for _, tc := range cases {
		t.Run(tc.want, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			_, err := tx.Exec(ctx, `UPDATE invoices SET status = $2, due_date = CURRENT_DATE + $3::int WHERE id = $1`,
				invID, tc.status, tc.dueDays)
			require.NoError(t, err)
			inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetByID(ctx, invID)
			require.NoError(t, err)

			srv := assetServer(t, tx)
			res, err := srv.Client().Get(srv.URL + "/invoices/export.xlsx?q=" + inv.InvoiceNo)
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			raw, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			f, err := excelize.OpenReader(bytes.NewReader(raw))
			require.NoError(t, err)
			rows, err := f.GetRows(f.GetSheetName(0))
			require.NoError(t, err)
			require.Len(t, rows, 2)
			assert.Equal(t, "Status", rows[0][5])
			assert.Equal(t, tc.want, rows[1][5])
		})
	}
}
