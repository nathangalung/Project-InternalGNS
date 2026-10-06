package quotations

import "github.com/nathangalung/internalgns/apps/api/internal/shared/roles"

// Figures hidden per role.
//
// A hidden figure is blanked and its omitempty tag drops the key, so the
// web tells hidden from zero. Operational input sees no selling figure;
// a shipping line's price is a selling figure too.

func (q *Quotation) redact(role string) {
	if roles.SeesSelling(role) {
		return
	}
	q.DiscountPct, q.TotalProduk, q.Total, q.TotalDiscount = "", "", "", ""
	q.Subtotal, q.DppNilaiLain, q.PpnAmount, q.GrandTotal = "", "", "", ""
}

func (it *QuotationItem) redact(role string) {
	if !roles.SeesSelling(role) {
		it.SellingPrice, it.DiscountPct, it.TotalSelling = "", "", ""
		it.DiscountAmount, it.Subtotal = "", ""
	}
	if !roles.SeesCost(role) {
		it.CostPrice = nil
	}
}

// movesStatus reports status rights.
// Only these move a quotation or revise it; the finance head reads it.
func movesStatus(role string) bool {
	return role == roles.Superadmin || role == roles.Operational
}

func (d *QuotationDetail) redact(role string) {
	d.Quotation.redact(role)
	for i := range d.Items {
		d.Items[i].redact(role)
	}
	if !movesStatus(role) {
		d.AllowedTransitions = []Transition{}
		d.CanRevise = false
	}
}

func (r *ListRow) redact(role string) {
	if !roles.SeesSelling(role) {
		r.GrandTotal, r.Subtotal, r.TotalDiscount = "", "", ""
	}
	if !roles.SeesCost(role) {
		r.TotalHargaBeli = ""
	}
}

func (r *RevisionRow) redact(role string) {
	if !roles.SeesSelling(role) {
		r.GrandTotal, r.TotalProduk = "", ""
	}
}

// probesSelling reports a total probe.
// A total filter or sort would let a role find a figure it cannot see.
func (f ListFilter) probesSelling() bool {
	return f.MinTotal != nil || f.MaxTotal != nil || sortable.Columns[f.SortBy].Expr == "q.grand_total"
}
