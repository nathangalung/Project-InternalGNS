package storage

import (
	"strings"
	"testing"
)

func TestBuildObjectKey_PrefixAndID(t *testing.T) {
	key := BuildObjectKey("po", 42, "scan.pdf")
	if !strings.HasPrefix(key, "po/42/") {
		t.Fatalf("expected prefix po/42/, got %q", key)
	}
	if !strings.HasSuffix(key, "-scan.pdf") {
		t.Fatalf("expected suffix -scan.pdf, got %q", key)
	}
}

func TestSanitizeFileName_StripPathTraversal(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"../../etc/passwd", "passwd"},
		{"foo/bar/baz.pdf", "baz.pdf"},
		{"normal.pdf", "normal.pdf"},
		{"with spaces.pdf", "with_spaces.pdf"},
		{"weird!@#$%.pdf", "weird_____.pdf"},
		{"", "file"},
		{"   ", "file"},
		{"backslash\\hack.pdf", "hack.pdf"},
	}
	for _, c := range cases {
		got := sanitizeFileName(c.in)
		if got != c.want {
			t.Errorf("sanitizeFileName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBuildObjectKey_SanitizesName(t *testing.T) {
	key := BuildObjectKey("po", 5, "../../../etc/passwd")
	if strings.Contains(key, "..") {
		t.Fatalf("path traversal leaked: %q", key)
	}
	if !strings.HasPrefix(key, "po/5/") {
		t.Fatalf("expected prefix po/5/, got %q", key)
	}
}
