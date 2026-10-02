package dashboard

import (
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// tile pairs status and label.
type tile struct{ status, label string }

// quotationTiles follows the quotation slice.
func quotationTiles() []tile {
	out := make([]tile, 0, len(quotations.Statuses))
	for _, s := range quotations.Statuses {
		out = append(out, tile{string(s.Status), s.Label})
	}
	return out
}

// poTiles follows the PO slice.
func poTiles() []tile {
	out := make([]tile, 0, len(purchaseorders.StatusOrder))
	for _, s := range purchaseorders.StatusOrder {
		out = append(out, tile{string(s), purchaseorders.StatusLabel(s)})
	}
	return out
}

// invoiceTiles follows the invoice slice.
func invoiceTiles() []tile {
	out := make([]tile, 0, len(invoices.StatusOrder))
	for _, s := range invoices.StatusOrder {
		out = append(out, tile{string(s), invoices.StatusLabel(s)})
	}
	return out
}

// fold zero-fills tiles in order.
// A stored status outside the order is dropped rather than shown unlabelled.
func fold(order []tile, counts map[string]int64) []StatusCount {
	out := make([]StatusCount, 0, len(order))
	for _, t := range order {
		out = append(out, StatusCount{Status: t.status, Label: t.label, Count: counts[t.status]})
	}
	return out
}
