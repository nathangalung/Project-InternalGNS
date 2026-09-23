package vendors

import (
	"net/url"
	"strings"
	"unicode/utf8"
)

// likeEscaper neutralises LIKE metacharacters.
//
// The backslash goes first: it is the default LIKE escape character, so an
// unescaped one in user input would consume the character after it.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// likeContains builds a literal contains pattern.
func likeContains(s string) string {
	return "%" + likeEscaper.Replace(s) + "%"
}

// badQueryParam names the first unstorable query value.
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
