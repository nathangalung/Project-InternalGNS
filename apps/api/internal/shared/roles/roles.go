// Package roles names the user roles and what each may see or change.
//
// Heads (operational, finance) and superadmin see every figure. The input
// roles see less: operational_input never sees a selling figure (harga
// jual, discount, totals, tax, profit), and finance_input never sees a cost
// figure (harga beli, profit). An unknown role fails closed everywhere.
package roles

const (
	Superadmin       = "superadmin"
	Operational      = "operational"
	OperationalInput = "operational_input"
	Finance          = "finance"
	FinanceInput     = "finance_input"
)

// SeesSelling reports harga jual access.
// Selling covers the line price, discount, totals, DPP, PPN and every
// figure derived from them.
func SeesSelling(role string) bool {
	switch role {
	case Superadmin, Operational, Finance, FinanceInput:
		return true
	}
	return false
}

// SeesCost reports harga beli access.
func SeesCost(role string) bool {
	switch role {
	case Superadmin, Operational, OperationalInput, Finance:
		return true
	}
	return false
}

// SeesProfit needs both sides.
func SeesProfit(role string) bool {
	return SeesSelling(role) && SeesCost(role)
}

// SetsPrices reports harga jual writes.
// Only these set a selling price or discount; every other writer keeps the
// stored ones.
func SetsPrices(role string) bool {
	return role == Superadmin || role == Operational
}

// SeesFinancialDashboard reports dashboard access.
func SeesFinancialDashboard(role string) bool {
	return role == Superadmin || role == Finance
}

// MovesQuotations reports status rights.
// Sending, accepting, rejecting, cancelling and revising a quotation stay
// with the owner; the operational head's last step is the PDF.
func MovesQuotations(role string) bool {
	return role == Superadmin
}

// ManagesPOs reports PO header writes.
// The PO file, number, notes and status; operational input keeps to the
// purchase price and vendor of each line.
func ManagesPOs(role string) bool {
	return role == Superadmin || role == Operational
}
