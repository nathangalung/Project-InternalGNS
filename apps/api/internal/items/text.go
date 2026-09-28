package items

import (
	"net/url"
	"strings"
	"unicode/utf8"
)

// badQueryParam names the first offender.
//
// Postgres rejects a NUL byte and invalid UTF-8 in a text parameter with
// SQLSTATE 22021, which would otherwise surface as a 500.
func badQueryParam(q url.Values) string {
	for key, values := range q {
		for _, v := range values {
			if !utf8.ValidString(v) || strings.ContainsRune(v, 0) {
				return key
			}
		}
	}
	return ""
}
