package dashboard

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// Tiles follow each status model.
func TestTilesFollowStatusModels(t *testing.T) {
	wantQuotation := make([]tile, 0, len(quotations.Statuses))
	for _, s := range quotations.Statuses {
		wantQuotation = append(wantQuotation, tile{string(s.Status), s.Label})
	}
	wantPo := make([]tile, 0, len(purchaseorders.StatusOrder))
	for _, s := range purchaseorders.StatusOrder {
		wantPo = append(wantPo, tile{string(s), purchaseorders.StatusLabel(s)})
	}
	wantInvoice := make([]tile, 0, len(invoices.StatusOrder))
	for _, s := range invoices.StatusOrder {
		wantInvoice = append(wantInvoice, tile{string(s), invoices.StatusLabel(s)})
	}

	tests := []struct {
		name string
		got  []tile
		want []tile
	}{
		{"quotation", quotationTiles(), wantQuotation},
		{"purchase order", poTiles(), wantPo},
		{"invoice", invoiceTiles(), wantInvoice},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.got)
		})
	}
}
