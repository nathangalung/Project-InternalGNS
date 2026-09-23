package dashboard

import "github.com/nathangalung/internalgns/apps/api/internal/invoices"

// tile pairs status and label.
type tile struct{ status, label string }

// Quotation and PO tile orders.
// Keys and labels match the quotations and purchaseorders status models.
var (
	quotationTiles = []tile{
		{"draft", "Draf"},
		{"sent", "Dikirim"},
		{"revision", "Revisi"},
		{"accepted", "Disetujui"},
		{"rejected", "Ditolak"},
		{"cancelled", "Dibatalkan"},
		{"expired", "Kedaluwarsa"},
	}
	poTiles = []tile{
		{"PENDING", "Pending"},
		{"UPLOADED", "PO Diunggah"},
		{"ON_PROGRESS", "Dalam Progres"},
		{"DELIVERED", "Dikirim"},
		{"CANCELLED", "Dibatalkan"},
	}
)

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
