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
// The finance roles only read a PO. Operational input runs the work but
// leaves cancelling to a head.
func movesFor(role string, moves []Transition) []Transition {
	out := []Transition{}
	for _, m := range moves {
		if canMove(role, m.To) {
			out = append(out, m)
		}
	}
	return out
}

func canMove(role string, to Status) bool {
	switch role {
	case roles.Superadmin, roles.Operational:
		return true
	case roles.OperationalInput:
		return to != StatusCancelled
	}
	return false
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

// keepStoredPrices restores harga jual.
//
// For a role that sets no price, each line must name a stored product
// line, all of them, and takes its stored harga jual; the discount and the
// shipping charge stay too. Harga beli, vendor and qty remain theirs.
func (r *Repo) keepStoredPrices(ctx context.Context, id int64, req *UpdateItemsRequest) error {
	po, err := r.GetByID(ctx, id)
	if err != nil {
		return err
	}
	lines, err := r.ListItems(ctx, id)
	if err != nil {
		return fmt.Errorf("stored po lines: %w", err)
	}
	stored := map[int64]string{}
	req.DiscountPct, req.ShippingCost = po.DiscountPct, nil
	for _, l := range lines {
		if l.ItemType == "shipping" {
			price := l.SellingPrice
			req.ShippingCost = &price
			continue
		}
		stored[l.ID] = l.SellingPrice
	}
	if len(req.Items) != len(stored) {
		return errLinesChanged
	}
	for i := range req.Items {
		it := &req.Items[i]
		if it.ID == nil {
			return errLinesChanged
		}
		price, ok := stored[*it.ID]
		if !ok {
			return errLinesChanged
		}
		it.SellingPrice = price
		delete(stored, *it.ID)
	}
	return nil
}
