package quotations

import (
	"context"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// BuildExportData exposes PDF shaping.
var BuildExportData = buildExportData

// ContactComm exposes the contact lookup.
func (h *ExportHandler) ContactComm(ctx context.Context, d QuotationDetail, c clients.Client) (string, string) {
	return h.contactComm(ctx, d, c)
}
