package functions

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// englishTell flags untranslated raise text.
// A user can reach most raises through the API, and httperr passes the
// message of a typed raise straight into the problem detail.
var englishTell = regexp.MustCompile(`(?i)\b(not found|must|cannot|mismatch|does not|read-only|has an?|belong)\b`)

// raises lists RAISE EXCEPTION statements.
// Each runs to the first semicolon outside a string literal.
func raises(body string) []string {
	var out []string
	for {
		i := strings.Index(body, "RAISE EXCEPTION")
		if i < 0 {
			return out
		}
		body = body[i:]
		inQuote, end := false, len(body)
		for j, r := range body {
			if r == '\'' {
				inQuote = !inQuote
			}
			if r == ';' && !inQuote {
				end = j + 1
				break
			}
		}
		out = append(out, body[:end])
		body = body[end:]
	}
}

// Raises are typed, Indonesian.
// httperr maps the SQLSTATE to a status; an untyped raise (P0001) or an
// English message would reach the user as it is.
func TestRaises_TypedAndIndonesian(t *testing.T) {
	files, err := filepath.Glob("*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, stmt := range raises(string(body)) {
			if !strings.Contains(stmt, "USING ERRCODE") {
				t.Errorf("%s: untyped raise: %s", f, stmt)
			}
			if m := englishTell.FindString(stmt); m != "" {
				t.Errorf("%s: English raise text (%q): %s", f, m, stmt)
			}
		}
	}
}

// The scanner skips quoted semicolons.
func TestRaisesScanner(t *testing.T) {
	got := raises(`x; RAISE EXCEPTION 'a; b %', v USING ERRCODE = 'P0014'; y; RAISE EXCEPTION 'c'`)
	want := []string{
		`RAISE EXCEPTION 'a; b %', v USING ERRCODE = 'P0014';`,
		`RAISE EXCEPTION 'c'`,
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("raises() = %q, want %q", got, want)
	}
}
