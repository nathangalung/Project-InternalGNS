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

// The due date never precedes the invoice date (INV-9).
// A refusal names the first reason in order: filed, misordered, stale.
func TestRepo_UpdateDates_DateOrder(t *testing.T) {
	stale := int32(999)
	cases := []struct {
		name     string
		path     []invoices.Status
		invShift *int // days from the stored invoice date
		dueShift *int
		stale    bool
		noMatch  bool
		want     error
	}{
		{name: "due before the stored invoice date", dueShift: days(-1), want: invoices.ErrDueBeforeInvoice},
		{name: "invoice date moved past the stored due date", invShift: days(31), want: invoices.ErrDueBeforeInvoice},
		{name: "both moved out of order", invShift: days(10), dueShift: days(9), want: invoices.ErrDueBeforeInvoice},
		{name: "due on the invoice date", dueShift: days(0), want: nil},
		{name: "both moved in order", invShift: days(10), dueShift: days(40), want: nil},
		{name: "misordered without If-Match", dueShift: days(-1), noMatch: true, want: invoices.ErrDueBeforeInvoice},
		{name: "misordered beats a stale version", dueShift: days(-1), stale: true, want: invoices.ErrDueBeforeInvoice},
		{name: "ordered with a stale version", dueShift: days(5), stale: true, want: invoices.ErrVersionMismatch},
		{name: "filed beats misordered", path: []invoices.Status{invoices.StatusSent, invoices.StatusPaid},
			dueShift: days(-1), want: invoices.ErrDatesLocked},
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
			var req invoices.UpdateDatesRequest
			if tc.invShift != nil {
				d := before.InvoiceDate.AddDate(0, 0, *tc.invShift)
				req.InvoiceDate = &d
			}
			if tc.dueShift != nil {
				d := before.InvoiceDate.AddDate(0, 0, *tc.dueShift)
				req.DueDate = &d
			}
			version := &before.RowVersion
			if tc.stale {
				version = &stale
			}
			if tc.noMatch {
				version = nil
			}

			_, err = repo.UpdateDates(ctx, invID, req, seedUserID, version)
			after, gerr := repo.GetByID(ctx, invID)
			require.NoError(t, gerr)
			require.NotNil(t, after.DueDate)
			if tc.want == nil {
				require.NoError(t, err)
				assert.False(t, after.DueDate.Before(after.InvoiceDate), "stored due date precedes the invoice date")
				return
			}
			assert.ErrorIs(t, err, tc.want)
			assert.Equal(t, before.InvoiceDate, after.InvoiceDate, "a refusal keeps the invoice date")
			assert.Equal(t, *before.DueDate, *after.DueDate, "a refusal keeps the due date")
		})
	}
}

func days(n int) *int { return &n }
