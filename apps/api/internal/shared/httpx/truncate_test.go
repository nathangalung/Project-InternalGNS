package httpx

import (
	"bytes"
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
)

// Capped exports leave warnings.
func TestWarnIfTruncated(t *testing.T) {
	cases := []struct {
		name     string
		total    int64
		returned int
		warn     bool
	}{
		{"cut below the total", 1200, 1000, true},
		{"complete", 1000, 1000, false},
		{"empty", 0, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })

			WarnIfTruncated(context.Background(), "invoices.export", c.total, c.returned)
			if !c.warn {
				assert.Empty(t, buf.String())
				return
			}
			out := buf.String()
			assert.Contains(t, out, "level=WARN")
			assert.Contains(t, out, "op=invoices.export")
			assert.Contains(t, out, "total=1200")
			assert.Contains(t, out, "returned=1000")
		})
	}
}
