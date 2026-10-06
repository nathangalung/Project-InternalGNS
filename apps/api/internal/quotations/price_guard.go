package quotations

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Writes keep stored prices.
//
// A role that sets no price (roles.SetsPrices false) may still add and
// edit lines: new lines start at harga jual 0 for a head to price, and a
// saved line, the discount and the shipping charge keep what is stored,
// whatever the body carries.

// unpriced zeroes new lines.
func unpriced(items []CreateItem) {
	for i := range items {
		items[i].SellingPrice = "0"
	}
}

// keepLinePrice restores a line's price.
// A missing line keeps 0; the save then reports it missing.
func (r *Repo) keepLinePrice(ctx context.Context, id, lineID int64, item *CreateItem) error {
	err := r.db.QueryRow(ctx, r.store.Get("quotations.stored_line_price"), id, lineID).Scan(&item.SellingPrice)
	if errors.Is(err, pgx.ErrNoRows) {
		item.SellingPrice = "0"
		return nil
	}
	if err != nil {
		return fmt.Errorf("stored line price: %w", err)
	}
	return nil
}

// keepHeaderPrices restores discount and shipping.
// A missing quotation keeps no discount; the save then reports it missing.
func (r *Repo) keepHeaderPrices(ctx context.Context, id int64, req *HeaderRequest) error {
	err := r.db.QueryRow(ctx, r.store.Get("quotations.stored_header_prices"), id).
		Scan(&req.DiscountPct, &req.ShippingCost)
	if errors.Is(err, pgx.ErrNoRows) {
		req.DiscountPct, req.ShippingCost = "0", nil
		return nil
	}
	if err != nil {
		return fmt.Errorf("stored header prices: %w", err)
	}
	return nil
}
