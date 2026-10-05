package testutil

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// EnterPONumber numbers a PO.
// Accepting a quotation leaves the client's PO number empty and ON_PROGRESS
// requires one, so a test walking a PO into work enters it first, as the
// user does. A PO that has a number keeps it.
func EnterPONumber(t testing.TB, ctx context.Context, exec db.Executor, poID int64) {
	t.Helper()
	_, err := exec.Exec(ctx,
		`UPDATE purchase_orders SET po_number = 'PO-UJI-' || id WHERE id = $1 AND po_number IS NULL`, poID)
	require.NoError(t, err)
}
