package invoices_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Terlambat follows the due date.
// Asking for it only confirms what the due date already says: past due is a
// no-op, not yet due is refused.
func TestRepo_ChangeStatus_OverdueIsDerived(t *testing.T) {
	cases := []struct {
		name       string
		path       []invoices.Status
		pastDue    bool
		want       error
		wantStored invoices.Status
	}{
		{name: "past-due draft stays draft", pastDue: true, want: nil, wantStored: invoices.StatusDraft},
		{name: "past-due sent stays sent", path: []invoices.Status{invoices.StatusSent}, pastDue: true, want: nil, wantStored: invoices.StatusSent},
		{name: "sent before due is refused", path: []invoices.Status{invoices.StatusSent}, want: invoices.ErrOverdueDerived, wantStored: invoices.StatusSent},
		{name: "draft before due is refused", want: invoices.ErrOverdueDerived, wantStored: invoices.StatusDraft},
		{name: "paid past due is refused", path: []invoices.Status{invoices.StatusSent, invoices.StatusPaid}, pastDue: true, want: invoices.ErrOverdueDerived, wantStored: invoices.StatusPaid},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			repo := invoices.NewRepo(tx, testutil.Store(t))

			if tc.pastDue {
				_, err := tx.Exec(ctx, `UPDATE invoices SET due_date = CURRENT_DATE - 1 WHERE id = $1`, invID)
				require.NoError(t, err)
			}
			for _, target := range tc.path {
				require.NoError(t, repo.ChangeStatus(ctx, invID, move(target), seedUserID))
			}

			err := repo.ChangeStatus(ctx, invID, move(invoices.StatusOverdue), seedUserID)
			if tc.want == nil {
				require.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, tc.want)
			}

			after, err := repo.GetByID(ctx, invID)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStored, after.Status)
		})
	}
}
