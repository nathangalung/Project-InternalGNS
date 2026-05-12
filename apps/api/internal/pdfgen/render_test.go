package pdfgen

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Stub binary that writes doc.pdf.
const stubBinary = `#!/usr/bin/env bash
set -e
outdir="."
for arg in "$@"; do
  case "$arg" in
    -output-directory=*) outdir="${arg#-output-directory=}";;
  esac
done
printf "%%PDF-1.4 stub\n" > "$outdir/doc.pdf"
exit 0
`

// Stub binary that fails.
const stubFail = `#!/usr/bin/env bash
echo "boom" >&2
exit 1
`

func writeStub(t *testing.T, body string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("bash stub unavailable on windows")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "xelatex-stub")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	return path
}

func writeTemplate(t *testing.T, body string) (root, name string) {
	t.Helper()
	root = t.TempDir()
	name = "doc.tex.tmpl"
	if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
		t.Fatalf("write template: %v", err)
	}
	return root, name
}

func TestNewRenderer_Defaults(t *testing.T) {
	r := NewRenderer("/tmp/x")
	if r.templatesRoot != "/tmp/x" {
		t.Errorf("templatesRoot = %q", r.templatesRoot)
	}
	if r.xelatexBinary != "xelatex" {
		t.Errorf("xelatexBinary = %q", r.xelatexBinary)
	}
	if r.timeout <= 0 {
		t.Errorf("timeout = %v", r.timeout)
	}
}

func TestTruncate(t *testing.T) {
	if got := truncate("short", 100); got != "short" {
		t.Errorf("got %q", got)
	}
	got := truncate("0123456789", 4)
	want := "0123...(truncated)"
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestJakartaDateLine(t *testing.T) {
	tm := time.Date(2026, time.May, 11, 12, 0, 0, 0, time.UTC)
	got := JakartaDateLine(tm)
	want := "Jakarta, 11 May 2026"
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestFuncMap(t *testing.T) {
	m := funcMap()
	if _, ok := m["esc"]; !ok {
		t.Error("missing esc")
	}
	if _, ok := m["idr"]; !ok {
		t.Error("missing idr")
	}
}

func TestRender_HappyPath(t *testing.T) {
	root, name := writeTemplate(t, `[[esc .Name]] [[idr .Amount]]`)
	bin := writeStub(t, stubBinary)

	r := NewRenderer(root)
	r.xelatexBinary = bin

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pdf, err := r.Render(ctx, name, map[string]any{"Name": "Test", "Amount": "1000"})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.HasPrefix(string(pdf), "%PDF") {
		t.Errorf("not a pdf: %q", string(pdf))
	}
}

func TestRender_MissingTemplate(t *testing.T) {
	r := NewRenderer(t.TempDir())
	_, err := r.Render(context.Background(), "no-such.tmpl", nil)
	if err == nil {
		t.Fatal("expected parse error")
	}
	if !strings.Contains(err.Error(), "parse template") {
		t.Errorf("wrong error: %v", err)
	}
}

func TestRender_BadTemplateExpr(t *testing.T) {
	root, name := writeTemplate(t, `[[.Missing.Inner]]`)
	bin := writeStub(t, stubBinary)
	r := NewRenderer(root)
	r.xelatexBinary = bin

	type empty struct{}
	_, err := r.Render(context.Background(), name, empty{})
	if err == nil {
		t.Fatal("expected execute error")
	}
	if !strings.Contains(err.Error(), "execute template") {
		t.Errorf("wrong error: %v", err)
	}
}

func TestRender_BinaryFails(t *testing.T) {
	root, name := writeTemplate(t, `static body`)
	bin := writeStub(t, stubFail)
	r := NewRenderer(root)
	r.xelatexBinary = bin

	_, err := r.Render(context.Background(), name, nil)
	if err == nil {
		t.Fatal("expected binary failure")
	}
	if !strings.Contains(err.Error(), "xelatex failed") {
		t.Errorf("wrong error: %v", err)
	}
}

func TestRender_BinaryMissing(t *testing.T) {
	root, name := writeTemplate(t, `body`)
	r := NewRenderer(root)
	r.xelatexBinary = "/nonexistent/xelatex-stub-xyz"

	_, err := r.Render(context.Background(), name, nil)
	if err == nil {
		t.Fatal("expected binary missing error")
	}
}

func TestRender_BinaryProducesNoPDF(t *testing.T) {
	root, name := writeTemplate(t, `body`)
	bin := writeStub(t, `#!/usr/bin/env bash
exit 0
`)
	r := NewRenderer(root)
	r.xelatexBinary = bin

	_, err := r.Render(context.Background(), name, nil)
	if err == nil {
		t.Fatal("expected pdf-not-produced error")
	}
	if !strings.Contains(err.Error(), "pdf not produced") {
		t.Errorf("wrong error: %v", err)
	}
}
