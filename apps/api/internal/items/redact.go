package items

import "github.com/nathangalung/internalgns/apps/api/internal/shared/roles"

// Figures hidden per role.
//
// A hidden figure is blanked and its omitempty tag drops the key. Finance
// input sees no harga beli, operational input no harga jual.

func (v *VendorForItem) redact(role string) {
	if !roles.SeesCost(role) {
		v.CostPrice = nil
	}
}

func (q *ItemQuotation) redact(role string) {
	if !roles.SeesCost(role) {
		q.CostPrice = nil
	}
	if !roles.SeesSelling(role) {
		q.SellingPrice = ""
	}
}

func (rec *Recommendation) redact(role string) {
	if !roles.SeesSelling(role) {
		rec.SellingPrice = nil
	}
	if !roles.SeesCost(role) {
		rec.CostPrice = nil
	}
}
