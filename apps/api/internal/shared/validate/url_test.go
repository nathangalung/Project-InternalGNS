package validate

import (
	"strings"
	"testing"
)

// Links are web addresses.
// Only http and https with a host pass, so a stored link can never run as
// script when the web renders it as a link. The product link and the
// vendor's store link share the rule and differ only in the message.
func TestWebURLs(t *testing.T) {
	cases := []struct {
		name, in string
		ok       bool
	}{
		{"tokopedia short link", "https://tk.tokopedia.com/ZSbXvQQ4c/", true},
		{"shopee short link", "https://id.shp.ee/WRWdTCmh", true},
		{"plain http", "http://toko.example/item?id=1", true},
		{"script scheme", "javascript:alert(1)", false},
		{"data scheme", "data:text/html,hi", false},
		{"no scheme", "tokopedia.com/item", false},
		{"no host", "https:///path", false},
		{"spaces inside", "https://toko.example/a b", false},
		{"bad escape", "https://toko.example/%zz", false},
		{"too long", "https://toko.example/" + strings.Repeat("a", 2048), false},
	}
	checks := []struct {
		name string
		fn   func(string) string
		msg  string
	}{
		{"ProductURL", ProductURL, ProductURLMessage},
		{"StoreURL", StoreURL, StoreURLMessage},
	}
	for _, chk := range checks {
		for _, c := range cases {
			t.Run(chk.name+" "+c.name, func(t *testing.T) {
				want := chk.msg
				if c.ok {
					want = ""
				}
				if got := chk.fn(c.in); got != want {
					t.Errorf("%s(%q) = %q, want %q", chk.name, c.in, got, want)
				}
			})
		}
	}
}
