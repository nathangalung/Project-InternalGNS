package httpx

import (
	"context"
	"log/slog"
)

// WarnIfTruncated logs when a list response was capped below its true total.
// Exports opt out of pagination but the repo still clamps, so a large result
// set is silently cut; this leaves the operator a signal until the export
// path is made unbounded.
func WarnIfTruncated(ctx context.Context, op string, total int64, returned int) {
	if total > int64(returned) {
		slog.WarnContext(ctx, "list truncated below total",
			"op", op, "total", total, "returned", returned)
	}
}
