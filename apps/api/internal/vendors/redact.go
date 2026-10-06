package vendors

import "github.com/nathangalung/internalgns/apps/api/internal/shared/roles"

// Cost figures hidden per role.
//
// A vendor's total purchase and its harga beli are cost figures, which
// finance input does not see. A blanked field drops its key.

func (v *Vendor) redact(role string) {
	if !roles.SeesCost(role) {
		v.TotalPurchase = ""
	}
}

func (it *ItemByVendor) redact(role string) {
	if !roles.SeesCost(role) {
		it.CostPrice = nil
	}
}

// probesCost reports a total probe.
func (f ListFilter) probesCost() bool {
	return f.MinTotal != nil || sortable.Columns[f.SortBy].Expr == totalPurchaseExpr
}
