package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Quotation cleanup takes PO, invoice.
func TestCleaner_QuotationRemovesPOAndInvoice(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	var qid, poID int64

	t.Run("tracked scope", func(t *testing.T) {
		c := testutil.NewCleaner(t)
		qrepo := quotations.NewRepo(pool, testutil.Store(t))
		var err error
		qid, err = qrepo.Create(ctx, quotations.CreateRequest{
			CompanyClientID: seedCompanyID,
			DiscountPct:     "0",
			Items: []quotations.CreateItem{{
				RequestedName: "Cleaner Product", Qty: "1", UnitID: seedUnitID, SellingPrice: "1000",
			}},
		}, seedUserID)
		require.NoError(t, err)
		c.Quotation(qid)
		require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
		require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

		porepo := purchaseorders.NewRepo(pool, testutil.Store(t))
		po, err := porepo.GetByQuotation(ctx, qid)
		require.NoError(t, err)
		poID = po.ID
		require.NoError(t, porepo.UpdateFile(ctx, poID, purchaseorders.UpdateFileRequest{
			FileName: "po.pdf", FileSize: 1, ObjectKey: "po/cleaner/1-po.pdf",
		}, seedUserID))
		for _, s := range []purchaseorders.Status{purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered} {
			require.NoError(t, porepo.ChangeStatus(ctx, poID, s, seedUserID))
		}
		var invoices int
		require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM invoices WHERE po_id = $1`, poID).Scan(&invoices))
		require.Equal(t, 1, invoices, "delivery should have created the invoice")
	})

	counts := []struct {
		name string
		sql  string
		id   int64
	}{
		{"invoices", `SELECT count(*) FROM invoices WHERE po_id = $1`, poID},
		{"purchase_orders", `SELECT count(*) FROM purchase_orders WHERE id = $1`, poID},
		{"quotations", `SELECT count(*) FROM quotations WHERE id = $1`, qid},
	}
	for _, c := range counts {
		var n int
		require.NoError(t, pool.QueryRow(ctx, c.sql, c.id).Scan(&n))
		require.Zero(t, n, "%s left behind", c.name)
	}
}
