package quotations

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	dbpkg "github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// Writes keep stored prices.
//
// A role that sets no price (roles.SetsPrices false) may still add and
// edit lines: new lines start at harga jual 0 for a head to price, and a
// saved line, the discount and the shipping charge keep what is stored,
// whatever the body carries. Tidak Ditawarkan stores harga jual 0, so such
// a role marks only a line no head has priced; putting a line back on
// offer changes no selling figure and stays open to it.

// ErrPricedNoOffer refuses unpricing a priced line.
var ErrPricedNoOffer = errors.New("priced line marked no offer by a role that sets no price")

// MsgPricedNoOffer says why.
const MsgPricedNoOffer = "Baris ini sudah diberi harga jual. Minta kepala operasional untuk menandai Tidak Ditawarkan."

// ErrNoTx marks a non-transactional executor.
var ErrNoTx = errors.New("quotations: executor cannot begin a transaction")

// unpriced zeroes new lines.
func unpriced(items []CreateItem) {
	for i := range items {
		items[i].SellingPrice = "0"
	}
}

// UpdateLineKeepingPrice saves a line, keeping its price.
// The stored harga jual replaces the body's.
func (r *Repo) UpdateLineKeepingPrice(ctx context.Context, id, lineID int64, item CreateItem, userID int64) error {
	noOffer := item.IsAvailable != nil && !*item.IsAvailable
	return r.keepingLine(ctx, id, lineID, noOffer, func(tx *Repo, stored string) error {
		item.SellingPrice = stored
		return tx.UpdateLine(ctx, id, lineID, item, userID)
	})
}

// SetLineOfferKeepingPrice toggles without unpricing.
func (r *Repo) SetLineOfferKeepingPrice(ctx context.Context, id, lineID int64, available bool, userID int64) error {
	return r.keepingLine(ctx, id, lineID, !available, func(tx *Repo, _ string) error {
		return tx.SetLineOffer(ctx, id, lineID, available, userID)
	})
}

// keepingLine runs one guarded line write.
//
// It locks the quotation row first, as fn_quotation_lock_draft does for
// every draft write, then reads the line's stored harga jual in a later
// statement, whose snapshot holds any price committed while the lock
// waited, and runs save in the same transaction, so no head's price lands
// between the read and the write. A draft line a head priced refuses
// noOffer. A missing quotation or line, or a quotation past draft, passes
// on to the function's own refusal; a missing line keeps 0.
func (r *Repo) keepingLine(
	ctx context.Context, id, lineID int64, noOffer bool, save func(tx *Repo, stored string) error,
) error {
	b, ok := r.db.(dbpkg.TxBeginner)
	if !ok {
		return ErrNoTx
	}
	return dbpkg.WithTx(ctx, b, func(tx pgx.Tx) error {
		// No row scans nothing, so a missing row keeps the defaults.
		var status Status
		err := tx.QueryRow(ctx, r.store.Get("quotations.lock_status"), id).Scan(&status)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("lock quotation: %w", err)
		}
		stored, priced := "0", false
		err = tx.QueryRow(ctx, r.store.Get("quotations.stored_line_price"), id, lineID).Scan(&stored, &priced)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("stored line price: %w", err)
		}
		if noOffer && priced && status == StatusDraft {
			return ErrPricedNoOffer
		}
		return save(&Repo{db: tx, store: r.store}, stored)
	})
}

// keepHeaderPrices restores discount and shipping.
// A missing quotation keeps no discount; the save then reports it missing.
func (r *Repo) keepHeaderPrices(ctx context.Context, id int64, req *HeaderRequest) error {
	// The PPN choice is a price too; nil keeps the stored one
	req.PPNEnabled = nil
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
