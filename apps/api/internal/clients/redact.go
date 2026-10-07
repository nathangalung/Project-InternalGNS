package clients

import "github.com/nathangalung/internalgns/apps/api/internal/shared/roles"

// Client access per role.
//
// A client's total purchase and its quotation totals are selling figures,
// which operational input does not see; a blanked field drops its key.

func (c *Client) redact(role string) {
	if !roles.SeesSelling(role) {
		c.TotalPurchase = ""
	}
}

func (q *ClientQuotation) redact(role string) {
	if !roles.SeesSelling(role) {
		q.GrandTotal = ""
	}
}

// probesSelling reports a total probe.
func (f ListFilter) probesSelling() bool {
	return f.MinTotal != nil || sortable.Columns[f.SortBy].Expr == totalPurchaseExpr
}
