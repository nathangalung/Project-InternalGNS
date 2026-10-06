package validate

import (
	"strings"
	"testing"
)

// Store links are web addresses.
// Only http and https with a host pass, so a stored link can never run as
// script when the web renders it as a link.
func TestProductURL(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"tokopedia short link", "https://tk.tokopedia.com/ZSbXvQQ4c/", ""},
		{"shopee short link", "https://id.shp.ee/WRWdTCmh", ""},
		{"plain http", "http://toko.example/item?id=1", ""},
		{"script scheme", "javascript:alert(1)", URLMessage},
		{"data scheme", "data:text/html,hi", URLMessage},
		{"no scheme", "tokopedia.com/item", URLMessage},
		{"no host", "https:///path", URLMessage},
		{"spaces inside", "https://toko.example/a b", URLMessage},
		{"too long", "https://toko.example/" + strings.Repeat("a", 2048), URLMessage},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ProductURL(c.in); got != c.want {
				t.Errorf("ProductURL(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
