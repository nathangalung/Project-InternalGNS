package httpx

import "testing"

func TestParseDateParam(t *testing.T) {
	cases := []struct {
		in     string
		wantOK bool
		want   string // YYYY-MM-DD of the parsed instant when wantOK
	}{
		{"", false, ""},
		{"   ", false, ""},
		{"not-a-date", false, ""},
		{"2026-08-01", true, "2026-08-01"},
		{"  2026-08-01  ", true, "2026-08-01"},
		{"2026-08-01T09:30:00Z", true, "2026-08-01"},
	}
	for _, c := range cases {
		got := ParseDateParam(c.in)
		if c.wantOK {
			if got == nil {
				t.Errorf("ParseDateParam(%q) = nil, want %s", c.in, c.want)
				continue
			}
			if got.Format("2006-01-02") != c.want {
				t.Errorf("ParseDateParam(%q) = %s, want %s", c.in, got.Format("2006-01-02"), c.want)
			}
		} else if got != nil {
			t.Errorf("ParseDateParam(%q) = %v, want nil", c.in, got)
		}
	}
}
