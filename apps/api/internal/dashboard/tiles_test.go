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
	var wantQuotation []tile
	for _, s := range quotations.Statuses {
		wantQuotation = append(wantQuotation, tile{string(s.Status), s.Label})
	}
	var wantPo []tile
	for _, s := range purchaseorders.StatusOrder {
		wantPo = append(wantPo, tile{string(s), purchaseorders.StatusLabel(s)})
	}
	var wantInvoice []tile
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
