package migrations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const changeClientMigration = "00116_change_client.sql"

// Backfill copies the quotation's contact.
// A PO on its quotation's client takes the contact the gate read until now,
// without a row_version bump; a PO on another client keeps its own.
func TestMigration00116_BackfillsPOContact(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	accept := func(name string) (int64, int64) {
		qid, err := qrepo.Create(ctx, quotations.CreateRequest{
			ValidityDays:    testutil.Validity(),
			CompanyClientID: 1,
			ContactID:       new(int64(1)),
			DiscountPct:     "0",
			Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
				{RequestedName: name, Qty: "1", UnitID: 19, SellingPrice: "1000"},
			}),
		}, 1)
		require.NoError(t, err)
		require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, 1))
		require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, 1))
		var po int64
		require.NoError(t, tx.QueryRow(ctx, `SELECT id FROM purchase_orders WHERE quotation_id = $1`, qid).Scan(&po))
		return qid, po
	}
	_, drifted := accept("Migrasi 00116 bergeser")
	_, moved := accept("Migrasi 00116 pindah")

	var other int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (name, created_by, updated_by) VALUES ('Migrasi 00116', 1, 1) RETURNING id`).Scan(&other))
	_, err := tx.Exec(ctx, `UPDATE purchase_orders SET contact_id = NULL WHERE id = $1`, drifted)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE purchase_orders SET contact_id = NULL, company_client_id = $2 WHERE id = $1`, moved, other)
	require.NoError(t, err)
	var versionBefore int32
	require.NoError(t, tx.QueryRow(ctx, `SELECT row_version FROM purchase_orders WHERE id = $1`, drifted).Scan(&versionBefore))

	_, err = tx.Exec(ctx, upSQL(t, changeClientMigration))
	require.NoError(t, err)

	var contact *int64
	var version int32
	require.NoError(t, tx.QueryRow(ctx, `SELECT contact_id, row_version FROM purchase_orders WHERE id = $1`, drifted).
		Scan(&contact, &version))
	require.NotNil(t, contact)
	assert.Equal(t, int64(1), *contact, "takes the quotation's contact")
	assert.Equal(t, versionBefore, version, "backfill keeps row_version")

	require.NoError(t, tx.QueryRow(ctx, `SELECT contact_id FROM purchase_orders WHERE id = $1`, moved).Scan(&contact))
	assert.Nil(t, contact, "a PO on another client keeps its own")
}
