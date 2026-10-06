package clients

import "github.com/nathangalung/internalgns/apps/api/internal/shared/roles"

// Client access per role.
//
// A client's total purchase and its quotation totals are selling figures,
// which operational input does not see; a blanked field drops its key.
// Finance input changes a client's NPWP and TKU only.

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

// taxOnly keeps stored client fields.
// The finance input form sends the whole client with only those two open,
// so every other field is taken from the stored row.
func taxOnly(stored Client, req UpdateClientRequest) UpdateClientRequest {
	return UpdateClientRequest{
		Number:      stored.Number,
		Name:        stored.Name,
		NPWP:        req.NPWP,
		Address:     stored.Address,
		Email:       stored.Email,
		CountryCode: stored.CountryCode,
		TkuID:       req.TkuID,
		IsActive:    stored.IsActive,
	}
}
