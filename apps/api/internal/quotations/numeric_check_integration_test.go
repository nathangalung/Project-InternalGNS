package quotations_test

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// requireCheckViolation expects a CHECK refusal.
func requireCheckViolation(t *testing.T, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "want a database error, got %v", err)
	assert.Equal(t, db.SQLStateCheckViolation, pgErr.Code, pgErr.Message)
}

// The database refuses NaN and negative costs.
// The handler screens these first; the CHECKs keep any other writer out,
// since Postgres sorts NaN above every number and >= 0 lets it through.
func TestDB_LineNumbersChecked(t *testing.T) {
	cases := []struct {
		name  string
		spoil func(*quotations.CreateItem)
	}{
		{"qty NaN", func(it *quotations.CreateItem) { it.Qty = "NaN" }},
		{"selling NaN", func(it *quotations.CreateItem) { it.SellingPrice = "NaN" }},
		{"cost NaN", func(it *quotations.CreateItem) { it.CostPrice = strPtr("NaN") }},
		{"cost negative", func(it *quotations.CreateItem) { it.CostPrice = strPtr("-900000") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			q := newLiveDraft(t, ctx, repo)
			item := offered()
			c.spoil(&item)
			_, err := repo.AddLines(ctx, q.id, []quotations.CreateItem{item}, seedUserID)
			requireCheckViolation(t, err)
		})
	}
}

// Day counts must be positive.
// A negative validity expired a sent quotation on the next hourly run.
func TestDB_DayCountsChecked(t *testing.T) {
	addr := "Tanjung Priok"
	zero := 0
	cases := []struct {
		name string
		req  quotations.HeaderRequest
	}{
		{"validity zero", quotations.HeaderRequest{DiscountPct: "0", ValidityDays: &zero}},
		{"shipping days zero", quotations.HeaderRequest{DiscountPct: "0", ShippingAddress: &addr, ShippingDays: &zero}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			q := newLiveDraft(t, ctx, repo)
			_, err := repo.Lock(ctx, q.id, "header", seedUserID)
			require.NoError(t, err)
			requireCheckViolation(t, repo.UpdateHeader(ctx, q.id, c.req, seedUserID))
		})
	}
}

// A vendor price cannot be NaN.
// fn_prepare_quotation_lines writes a line's harga beli into vendor_products.
func TestDB_VendorCostChecked(t *testing.T) {
	ctx, _, tx := newRepo(t)
	_, err := tx.Exec(ctx, `UPDATE vendor_products SET cost_price = 'NaN' WHERE id = $1`, seedVendorProd)
	requireCheckViolation(t, err)
}
