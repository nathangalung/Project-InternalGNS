package migrations_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/migrations"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const noExpiredMigration = "00100_no_expired_quotation_status.sql"

// downSQL reads the Down half.
func downSQL(t *testing.T, name string) string {
	t.Helper()
	raw, err := migrations.FS.ReadFile(name)
	require.NoError(t, err)
	_, down, found := strings.Cut(string(raw), "-- +goose Down")
	require.True(t, found, "%s has no Down section", name)
	return down
}

// Expired quotations become sent.
// Down restores the status and the job; Up then moves an expired row back
// to sent without a row_version bump and drops its system history row.
func TestMigration00100_ExpiredBecomesSent(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := tx.Exec(ctx, downSQL(t, noExpiredMigration))
	require.NoError(t, err)

	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Migrasi 00100", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, quotations.StatusSent, nil, 1))
	_, err = tx.Exec(ctx, `UPDATE quotations SET status = 'expired' WHERE id = $1`, qid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `
		INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by)
		VALUES ($1, 'sent', 'expired', 'Kedaluwarsa otomatis', NULL)`, qid)
	require.NoError(t, err)
	var versionBefore int32
	require.NoError(t, tx.QueryRow(ctx, `SELECT row_version FROM quotations WHERE id = $1`, qid).Scan(&versionBefore))

	_, err = tx.Exec(ctx, upSQL(t, noExpiredMigration))
	require.NoError(t, err)

	var status string
	var version int32
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT status, row_version FROM quotations WHERE id = $1`, qid).Scan(&status, &version))
	assert.Equal(t, "sent", status)
	assert.Equal(t, versionBefore, version, "the move keeps row_version")

	var moves []string
	rows, err := tx.Query(ctx, `
		SELECT coalesce(from_status, '-') || '>' || to_status FROM quotation_status_history
		WHERE quotation_id = $1 ORDER BY changed_at, id`, qid)
	require.NoError(t, err)
	for rows.Next() {
		var m string
		require.NoError(t, rows.Scan(&m))
		moves = append(moves, m)
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, []string{"->draft", "draft>sent"}, moves, "history ends at the send")

	var jobs int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT count(*) FROM pg_proc WHERE proname = 'fn_expire_quotations'`).Scan(&jobs))
	assert.Zero(t, jobs, "the expiry job is gone")

	sp, err := tx.Begin(ctx)
	require.NoError(t, err)
	_, err = sp.Exec(ctx, `UPDATE quotations SET status = 'expired' WHERE id = $1`, qid)
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "expired must be refused: %v", err)
	assert.Equal(t, "23514", pgErr.Code)
	require.NoError(t, sp.Rollback(ctx))
}
