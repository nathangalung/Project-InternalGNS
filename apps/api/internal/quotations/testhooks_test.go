package quotations

import (
	"context"
	"time"
)

// BuildExportData exposes PDF shaping.
var BuildExportData = buildExportData

// ContactComm exposes the contact lookup.
func (h *ExportHandler) ContactComm(ctx context.Context, d QuotationDetail) (string, string, error) {
	return h.contactComm(ctx, d)
}

// SetStreamTiming shortens the stream clocks.
// It returns a restore func for t.Cleanup.
func SetStreamTiming(lifetime, ping time.Duration) func() {
	oldLife, oldPing := streamLifetime, streamPing
	streamLifetime, streamPing = lifetime, ping
	return func() { streamLifetime, streamPing = oldLife, oldPing }
}
