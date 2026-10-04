package migrations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const buyerSnapshotMigration = "00095_invoice_buyer_snapshot.sql"

// Backfill stores the current client.
// An invoice from before the columns takes its client as it is now, without
// a row_version bump; one that already has a buyer keeps it.
func TestMigration00095_BackfillsBuyer(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, err := quotations.NewRepo(tx, testutil.Store(t)).Create(ctx, quotations.CreateRequest{
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{
			{RequestedName: "Migrasi 00095", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		},
	}, 1)
	require.NoError(t, err)

	// The state before the columns existed.
	_, err = tx.Exec(ctx, `ALTER TABLE invoices ALTER COLUMN buyer_name DROP NOT NULL`)
	require.NoError(t, err)
	var legacy, kept int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, invoice_date, status, created_by, updated_by)
		VALUES ('INV-MIG-00095-A', $1, 1, CURRENT_DATE, 'paid', 1, 1) RETURNING id`, qid).Scan(&legacy))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, buyer_name, invoice_date, status, created_by, updated_by)
		VALUES ('INV-MIG-00095-B', $1, 1, 'PT Nama Lama', CURRENT_DATE, 'paid', 1, 1) RETURNING id`, qid).Scan(&kept))
	var versionBefore int32
	require.NoError(t, tx.QueryRow(ctx, `SELECT row_version FROM invoices WHERE id = $1`, legacy).Scan(&versionBefore))

	_, err = tx.Exec(ctx, upSQL(t, buyerSnapshotMigration))
	require.NoError(t, err)

	var matches bool
	var version int32
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT (inv.buyer_name, inv.buyer_npwp, inv.buyer_address)
		         IS NOT DISTINCT FROM (cc.name, cc.npwp, cc.address),
		       inv.row_version
		FROM invoices inv JOIN company_client cc ON cc.id = inv.company_client_id
		WHERE inv.id = $1`, legacy).Scan(&matches, &version))
	assert.True(t, matches, "backfilled from the client")
	assert.Equal(t, versionBefore, version, "backfill keeps row_version")

	var name string
	require.NoError(t, tx.QueryRow(ctx, `SELECT buyer_name FROM invoices WHERE id = $1`, kept).Scan(&name))
	assert.Equal(t, "PT Nama Lama", name)

	var notNull bool
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT attnotnull FROM pg_attribute
		WHERE attrelid = 'invoices'::regclass AND attname = 'buyer_name'`).Scan(&notNull))
	assert.True(t, notNull)
}
