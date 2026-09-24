package users

import "strings"

// likeEscaper neutralises LIKE metacharacters.
//
// The backslash goes first: it is the default LIKE escape character, so an
// unescaped one in user input would consume the character after it.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// likeContains builds a literal contains pattern.
func likeContains(s string) string {
	return "%" + likeEscaper.Replace(s) + "%"
}
