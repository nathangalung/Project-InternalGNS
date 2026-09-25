package httpx

import (
	"strings"
	"time"
)

// ParseDateParam parses query dates.
// It accepts YYYY-MM-DD or RFC3339 and returns nil when blank or
// unparseable.
func ParseDateParam(s string) *time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return &t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return &t
	}
	return nil
}
