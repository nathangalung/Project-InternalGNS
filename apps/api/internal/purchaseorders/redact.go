package purchaseorders

import (
	"context"
	"errors"
	"fmt"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

// Figures hidden per role.
//
// A hidden figure is blanked and its omitempty tag drops the key, so the
// web tells hidden from zero. Operational input sees no selling figure,
// finance input no cost, and profit needs both.

func (po *PurchaseOrder) redact(role string) {
	if !roles.SeesSelling(role) {
		po.DiscountPct, po.QuotationTotal, po.QuotationSubtotal = "", nil, nil
		po.PoSubtotal, po.PoTotalProduk, po.PoDppNilaiLain = "", "", ""
		po.PoPpnAmount, po.PoGrandTotal, po.PoTotalDiscount = "", "", ""
	}
	if !roles.SeesProfit(role) {
		po.PoTotalProfit = ""
	}
	po.AllowedTransitions = movesFor(role, po.AllowedTransitions)
}

func (it *PurchaseOrderItem) redact(role string) {
	if !roles.SeesSelling(role) {
		it.SellingPrice, it.Subtotal, it.TotalSelling = "", "", ""
	}
	if !roles.SeesCost(role) {
		it.CostPrice = nil
	}
	if !roles.SeesProfit(role) {
		it.ProfitAmount = nil
	}
}

// movesFor filters moves by role.
// Only superadmin and the operational head move a PO.
func movesFor(role string, moves []Transition) []Transition {
	out := []Transition{}
	for _, m := range moves {
		if canMove(role, m.To) {
			out = append(out, m)
		}
	}
	return out
}

func canMove(role string, _ Status) bool {
	return roles.ManagesPOs(role)
}

// probesSelling reports a total probe.
// A total filter or sort would let a role find a figure it cannot see.
func (f ListFilter) probesSelling() bool {
	return f.MinTotal != nil || f.MaxTotal != nil || sortable.Columns[f.SortBy].Expr == poTotalExpr
}

// errLinesChanged refuses line changes.
var errLinesChanged = errors.New("po lines added or removed by a role that sets no price")

// msgLinesChanged says why.
const msgLinesChanged = "Hanya kepala operasional yang dapat menambah atau menghapus baris PO."

// keepStoredSale restores all but purchase.
//
// For a role that sets no price, each line must name a stored product
// line, all of them, and keeps everything the client ordered: product,
// qty, unit, harga jual, availability and destination. Only harga beli and
// the vendor are theirs; the discount, shipping and notes stay too.
func (r *Repo) keepStoredSale(ctx context.Context, id int64, req *UpdateItemsRequest) error {
	po, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}
	lines, err := r.ListItems(ctx, id)
	if err != nil {
		return fmt.Errorf("stored po lines: %w", err)
	}
	stored := map[int64]PurchaseOrderItem{}
	req.DiscountPct, req.Notes = po.DiscountPct, po.Notes
	req.ShippingAddress, req.ShippingDays, req.ShippingCost = nil, nil, nil
	for _, l := range lines {
		if l.ItemType == "shipping" {
			price := l.SellingPrice
			req.ShippingAddress, req.ShippingDays, req.ShippingCost = l.ShipDestination, l.ShippingDays, &price
			continue
		}
		stored[l.ID] = l
	}
	if len(req.Items) != len(stored) {
		return errLinesChanged
	}
	for i := range req.Items {
		it := &req.Items[i]
		if it.ID == nil {
			return errLinesChanged
		}
		s, ok := stored[*it.ID]
		if !ok {
			return errLinesChanged
		}
		available := s.IsAvailable
		it.QuotationItemID, it.OfferedItemID = s.QuotationItemID, s.OfferedItemID
		it.ItemName, it.ItemCode, it.Qty, it.UnitID = s.ItemName, s.ItemCode, s.Qty, s.UnitID
		it.SellingPrice, it.IsAvailable, it.ShipDestination = s.SellingPrice, &available, s.ShipDestination
		delete(stored, *it.ID)
	}
	return nil
}
