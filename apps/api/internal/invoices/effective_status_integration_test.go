package invoices_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// All Terlambat readers agree.
// The tiles, the effective-status filter and the overdue probe all read
// fn_invoice_effective_status, so a legacy stored overdue whose due date is
// still ahead is Terlambat in each of them.
func TestEffectiveStatus_OneRuleEverywhere(t *testing.T) {
	cases := []struct {
		name    string
		status  string
		dueDays int
		want    invoices.Status
	}{
		{name: "legacy stored overdue, due ahead", status: "overdue", dueDays: 5, want: invoices.StatusOverdue},
		{name: "sent past due", status: "sent", dueDays: -1, want: invoices.StatusOverdue},
		{name: "draft past due", status: "draft", dueDays: -1, want: invoices.StatusOverdue},
		{name: "sent due today", status: "sent", dueDays: 0, want: invoices.StatusSent},
		{name: "draft due ahead", status: "draft", dueDays: 5, want: invoices.StatusDraft},
		{name: "paid past due", status: "paid", dueDays: -1, want: invoices.StatusPaid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			repo := invoices.NewRepo(tx, testutil.Store(t))

			// Park the row outside every tile, then count it in.
			_, err := tx.Exec(ctx, `UPDATE invoices SET status = 'cancelled' WHERE id = $1`, invID)
			require.NoError(t, err)
			before, err := repo.Summary(ctx)
			require.NoError(t, err)
			_, err = tx.Exec(ctx, `UPDATE invoices SET status = $2, due_date = CURRENT_DATE + $3::int WHERE id = $1`,
				invID, tc.status, tc.dueDays)
			require.NoError(t, err)
			after, err := repo.Summary(ctx)
			require.NoError(t, err)

			tiles := map[invoices.Status]int64{
				invoices.StatusDraft:   after.Draft - before.Draft,
				invoices.StatusSent:    after.Sent - before.Sent,
				invoices.StatusPaid:    after.Paid - before.Paid,
				invoices.StatusOverdue: after.Overdue - before.Overdue,
			}
			for s, delta := range tiles {
				want := int64(0)
				if s == tc.want {
					want = 1
				}
				assert.Equalf(t, want, delta, "%s tile", s)
			}

			inv, err := repo.GetByID(ctx, invID)
			require.NoError(t, err)
			for _, s := range []invoices.Status{invoices.StatusDraft, invoices.StatusSent, invoices.StatusPaid, invoices.StatusOverdue} {
				res, err := repo.List(ctx, invoices.ListFilter{Q: inv.InvoiceNo, EffectiveStatuses: []string{string(s)}, Limit: 10})
				require.NoError(t, err)
				assert.Equalf(t, s == tc.want, res.Total == 1, "filter %s", s)
			}
		})
	}
}
