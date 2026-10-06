package migrations_test

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const plainTextMigration = "00103_plain_function_text.sql"

// Shipping names and raises read plainly.
// Down restores the em dash and the id in a raise; Up renames the stored
// shipping line without a row_version bump and the raise names no id.
func TestMigration00103_PlainText(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := tx.Exec(ctx, downSQL(t, plainTextMigration))
	require.NoError(t, err)

	addr := "Dermaga Koja"
	cost := "50000"
	qid, err := quotations.NewRepo(tx, testutil.Store(t)).Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		ShippingAddress: &addr,
		ShippingCost:    &cost,
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Migrasi 00103", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)
	var name string
	var version int32
	row := `SELECT requested_name, row_version FROM quotation_items WHERE quotation_id = $1 AND item_type = 'shipping'`
	require.NoError(t, tx.QueryRow(ctx, row, qid).Scan(&name, &version))
	require.Equal(t, "SHIPPING — Dermaga Koja", name, "Down writes the old name")

	_, err = tx.Exec(ctx, upSQL(t, plainTextMigration))
	require.NoError(t, err)

	var after int32
	require.NoError(t, tx.QueryRow(ctx, row, qid).Scan(&name, &after))
	assert.Equal(t, "SHIPPING - Dermaga Koja", name)
	assert.Equal(t, version, after, "a rename is not an edit")

	_, err = tx.Exec(ctx, `SELECT fn_revise_quotation(-1, 1, NULL)`)
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr))
	assert.Equal(t, "Quotation tidak ditemukan. Muat ulang halaman.", pgErr.Message)
}
