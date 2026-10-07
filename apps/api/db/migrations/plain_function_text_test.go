package migrations_test

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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

	// Down recreates the create function as it was then; 00107 added an
	// overload with the PPN choice, which would make the call ambiguous.
	_, err = tx.Exec(ctx, `DROP FUNCTION fn_create_quotation(bigint, bigint, text, text, text,
		integer, numeric, text, integer, numeric, jsonb, bigint, text, text, boolean)`)
	require.NoError(t, err)
	var qid int64
	require.NoError(t, tx.QueryRow(ctx, `SELECT fn_create_quotation(1, NULL, NULL, NULL, NULL, 30, 0,
		'Dermaga Koja', NULL, 50000,
		'[{"requested_name": "Migrasi 00103", "qty": "1", "unit_id": 19, "selling_price": "1000"}]'::jsonb, 1)`).
		Scan(&qid))
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
