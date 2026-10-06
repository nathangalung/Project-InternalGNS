package validate

import (
	"net/url"
	"strings"
)

// URLMessage sits on a store link.
const URLMessage = "Link toko harus diawali http:// atau https://."

// maxURLLen bounds a stored link.
const maxURLLen = 2048

// ProductURL checks a store link.
// Only an http or https address with a host and no spaces passes, so the
// web can render it as a link that never runs script. s is checked as
// given; callers trim first and treat blank as no link. It returns "" when
// s passes.
func ProductURL(s string) string {
	if len(s) > maxURLLen || strings.ContainsAny(s, " \t\r\n") {
		return URLMessage
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return URLMessage
	}
	return ""
}
