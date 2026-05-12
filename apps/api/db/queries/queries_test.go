package queries

import "testing"

func TestLoad_AllRequiredPresent(t *testing.T) {
	store, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	for _, name := range RequiredKeys {
		body, ok := store[name]
		if !ok {
			t.Errorf("missing query: %s", name)
			continue
		}
		if body == "" {
			t.Errorf("empty body: %s", name)
		}
	}
}

func TestValidate_ReportsAllMissing(t *testing.T) {
	s := Store{"foo": "SELECT 1"}
	err := s.Validate([]string{"foo", "bar", "baz"})
	if err == nil {
		t.Fatal("expected error on missing keys")
	}
	msg := err.Error()
	if !contains(msg, "bar") || !contains(msg, "baz") {
		t.Errorf("error did not list both missing keys: %q", msg)
	}
}

func TestValidate_AllPresent(t *testing.T) {
	s := Store{"a": "SELECT 1", "b": "SELECT 2"}
	if err := s.Validate([]string{"a", "b"}); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestStore_GetPanicsOnMissing(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("expected panic on missing key")
		}
	}()
	Store{}.Get("does.not.exist")
}

func TestStore_GetReturnsSQL(t *testing.T) {
	s := Store{"foo": "SELECT 1"}
	if got := s.Get("foo"); got != "SELECT 1" {
		t.Errorf("got %q, want SELECT 1", got)
	}
}

func TestParseHeader(t *testing.T) {
	cases := []struct {
		line   string
		want   string
		wantOK bool
	}{
		{"-- name: foo.bar", "foo.bar", true},
		{"-- name:   spaced  ", "spaced", true},
		{"-- name:", "", false},
		{"-- name: ", "", false},
		{"-- something else", "", false},
		{"SELECT 1", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := parseHeader(c.line)
		if got != c.want || ok != c.wantOK {
			t.Errorf("parseHeader(%q) = (%q,%v), want (%q,%v)",
				c.line, got, ok, c.want, c.wantOK)
		}
	}
}

func TestParseInto_Basic(t *testing.T) {
	store := Store{}
	body := []byte("-- name: a\nSELECT 1;\n-- name: b\nSELECT 2\n")
	if err := parseInto(store, "x.sql", body); err != nil {
		t.Fatalf("parseInto: %v", err)
	}
	if store["a"] != "SELECT 1" {
		t.Errorf("a = %q", store["a"])
	}
	if store["b"] != "SELECT 2" {
		t.Errorf("b = %q", store["b"])
	}
}

func TestParseInto_DuplicateName(t *testing.T) {
	store := Store{"a": "old"}
	body := []byte("-- name: a\nSELECT 1\n")
	err := parseInto(store, "x.sql", body)
	if err == nil {
		t.Fatal("expected duplicate error")
	}
}

func TestParseInto_PreambleIgnored(t *testing.T) {
	store := Store{}
	body := []byte("-- a comment\nrandom prelude\n-- name: only\nSELECT 1\n")
	if err := parseInto(store, "x.sql", body); err != nil {
		t.Fatal(err)
	}
	if _, ok := store["only"]; !ok {
		t.Errorf("missing only")
	}
}

func TestParseInto_TrimsSemicolon(t *testing.T) {
	store := Store{}
	body := []byte("-- name: t\nSELECT 1 ;  \n")
	if err := parseInto(store, "x.sql", body); err != nil {
		t.Fatal(err)
	}
	if store["t"] != "SELECT 1" {
		t.Errorf("got %q", store["t"])
	}
}

func TestParseInto_EmptyBody(t *testing.T) {
	store := Store{}
	if err := parseInto(store, "x.sql", []byte("")); err != nil {
		t.Fatal(err)
	}
	if len(store) != 0 {
		t.Errorf("expected empty store")
	}
}

// Scanner buffer ceiling 1MB.
func TestParseInto_ScannerErrorOnOversizedLine(t *testing.T) {
	store := Store{}
	huge := make([]byte, 1024*1024+1)
	for i := range huge {
		huge[i] = 'x'
	}
	body := append([]byte("-- name: a\n"), huge...)
	err := parseInto(store, "x.sql", body)
	if err == nil {
		t.Fatal("expected scanner error")
	}
}
