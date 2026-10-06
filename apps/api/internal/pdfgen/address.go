package pdfgen

import (
	"regexp"
	"strings"
)

var (
	addrSpace     = regexp.MustCompile(`\s+`)
	addrSpaceComa = regexp.MustCompile(`\s*,\s*`)
	addrCommas    = regexp.MustCompile(`(,\s*)+,`)
)

// tiedWords stay with the next word.
// Street, floor and lot abbreviations read wrong at a line end.
var tiedWords = map[string]bool{
	"jl": true, "jln": true, "jalan": true, "lt": true, "no": true, "kav": true,
	"blok": true, "rt": true, "rw": true, "km": true, "gd": true, "gedung": true,
}

// NormalizeAddress tidies a typed address.
// Line breaks and stray spaces become one ", " between parts, a part glued
// to the comma gets its space, and a list of house numbers ("2,6,8") keeps
// its own commas.
func NormalizeAddress(s string) string {
	s = strings.NewReplacer("\r\n", ",", "\n", ",", "\r", ",").Replace(s)
	s = addrSpace.ReplaceAllString(s, " ")
	s = addrCommas.ReplaceAllString(s, ",")
	var b strings.Builder
	parts := addrSpaceComa.Split(s, -1)
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if b.Len() > 0 {
			prev := b.String()
			// "No. 2,6,8" and "KM 26,6": a bare number after a number.
			if isDigit(prev[len(prev)-1]) && allDigits(p) {
				b.WriteString(",")
			} else {
				b.WriteString(", ")
			}
		}
		b.WriteString(p)
	}
	return b.String()
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func allDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if !isDigit(s[i]) {
			return false
		}
	}
	return true
}

// LatexAddress breaks between parts.
// A part of at most keep characters never splits; a longer one may break
// between words, but an abbreviation such as Lt. or Kav. stays with the
// word after it. The comma between parts is the preferred break point.
func LatexAddress(s string, keep int) string {
	parts := strings.Split(NormalizeAddress(s), ", ")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		words := strings.Fields(p)
		var b strings.Builder
		whole := len([]rune(p)) <= keep
		for i, w := range words {
			if i > 0 {
				prev := strings.ToLower(strings.TrimSuffix(words[i-1], "."))
				if whole || tiedWords[prev] || strings.HasSuffix(words[i-1], ".") && len(words[i-1]) <= 5 {
					b.WriteString("~")
				} else {
					b.WriteString(" ")
				}
			}
			b.WriteString(LatexBreakable(w))
		}
		out = append(out, b.String())
	}
	return strings.Join(out, ", ")
}

// Part lengths kept whole.
// PartyKeep fits the party block's value column, CellKeep a table cell.
const (
	PartyKeep = 40
	CellKeep  = 24
)
