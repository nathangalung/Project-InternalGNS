package invoices

import "github.com/nathangalung/internalgns/apps/api/internal/shared/roles"

// Invoice access per role.
//
// Finance input sees what the client is billed but no harga beli, and only
// records payment: Lunas is its one move and it issues no Pengganti.

func (it *InvoiceItem) redact(role string) {
	if !roles.SeesCost(role) {
		it.CostPrice = nil
	}
}

func (d *InvoiceDetail) redact(role string) {
	if role != roles.FinanceInput {
		return
	}
	moves := []Transition{}
	for _, m := range d.AllowedTransitions {
		if m.To == StatusPaid {
			moves = append(moves, m)
		}
	}
	d.AllowedTransitions, d.CanReplace = moves, false
}

// canMove reports a role's move.
func canMove(role string, to Status) bool {
	return role != roles.FinanceInput || to == StatusPaid
}
