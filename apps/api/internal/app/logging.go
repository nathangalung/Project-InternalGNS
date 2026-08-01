package app

import (
	"context"
	"io"
	"log/slog"

	"github.com/go-chi/chi/v5/middleware"
)

// requestIDHandler stamps the chi request id onto every record, so a handler
// error line can be joined to its access-log line instead of correlated by
// timestamp across interleaved concurrent requests.
type requestIDHandler struct{ slog.Handler }

func (h requestIDHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := middleware.GetReqID(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, r)
}

func (h requestIDHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return requestIDHandler{h.Handler.WithAttrs(attrs)}
}

func (h requestIDHandler) WithGroup(name string) slog.Handler {
	return requestIDHandler{h.Handler.WithGroup(name)}
}

// NewLogger builds the JSON logger, request-id aware, at the given level.
func NewLogger(w io.Writer, level slog.Level) *slog.Logger {
	return slog.New(requestIDHandler{slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})})
}
