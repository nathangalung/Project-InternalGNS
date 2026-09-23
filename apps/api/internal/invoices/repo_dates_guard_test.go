package invoices_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A filed invoice keeps its dates: moving them would move booked revenue and
// the date already reported to Coretax.
func TestRepo_UpdateDates_RejectsFiledInvoice(t *testing.T) {
	cases := []struct {
		name string
		path []invoices.Status
		want error
	}{
		{name: "paid", path: []invoices.Status{invoices.StatusSent, invoices.StatusPaid}, want: invoices.ErrDatesLocked},
		{name: "cancelled", path: []invoices.Status{invoices.StatusCancelled}, want: invoices.ErrDatesLocked},
		{name: "sent stays editable", path: []invoices.Status{invoices.StatusSent}, want: nil},
		{name: "draft stays editable", path: nil, want: nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, _, invID := deliveredPOWithInvoice(t, tx)
			repo := invoices.NewRepo(tx, testutil.Store(t))

			for _, target := range tc.path {
				require.NoError(t, repo.ChangeStatus(ctx, invID, move(target), seedUserID))
			}

			before, err := repo.GetByID(ctx, invID)
			require.NoError(t, err)
			due := before.InvoiceDate.AddDate(0, 0, 60)
			version := before.RowVersion

			_, err = repo.UpdateDates(ctx, invID, invoices.UpdateDatesRequest{DueDate: &due}, seedUserID, &version)
			if tc.want == nil {
				require.NoError(t, err)
				return
			}
			assert.ErrorIs(t, err, tc.want)

			after, err := repo.GetByID(ctx, invID)
			require.NoError(t, err)
			require.NotNil(t, after.DueDate)
			assert.NotEqual(t, due.Format(time.DateOnly), after.DueDate.Format(time.DateOnly))
		})
	}
}
