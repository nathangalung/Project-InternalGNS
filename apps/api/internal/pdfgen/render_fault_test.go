package pdfgen

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// The semaphore follows the CPU budget.
func TestRenderConcurrency(t *testing.T) {
	cases := []struct {
		name  string
		env   string
		procs int
		want  int
	}{
		{"override", "3", 16, 3},
		{"zero override ignored", "0", 16, 8},
		{"garbage override ignored", "many", 6, 3},
		{"one core floors at two", "", 1, 2},
		{"four cores use two", "", 4, 2},
		{"ten cores use five", "", 10, 5},
		{"many cores cap at eight", "", 32, 8},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("PDF_RENDER_CONCURRENCY", c.env)
			prev := runtime.GOMAXPROCS(c.procs)
			t.Cleanup(func() { runtime.GOMAXPROCS(prev) })
			if got := renderConcurrency(); got != c.want {
				t.Errorf("renderConcurrency() = %d, want %d", got, c.want)
			}
		})
	}
}

// A render that outlives its budget reports the deadline.
func TestRender_Timeout(t *testing.T) {
	root, name := writeTemplate(t, `body`)
	r := NewRenderer(root)
	r.xelatexBinary = writeStub(t, "#!/usr/bin/env bash\nexec sleep 5\n")
	r.timeout = 100 * time.Millisecond

	start := time.Now()
	_, err := r.Render(context.Background(), name, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want deadline exceeded", err)
	}
	if !strings.HasPrefix(err.Error(), "xelatex: ") {
		t.Errorf("err = %q, want the xelatex prefix", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Error("the stuck xelatex was not killed at the deadline")
	}
}

// A full semaphore fails at the deadline, not later.
func TestRender_WaitsForSlotUntilDeadline(t *testing.T) {
	for range cap(renderSem) {
		renderSem <- struct{}{}
	}
	t.Cleanup(func() {
		for range cap(renderSem) {
			<-renderSem
		}
	})
	root, name := writeTemplate(t, `body`)
	r := NewRenderer(root)
	r.xelatexBinary = writeStub(t, stubBinary)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := r.Render(ctx, name, nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want deadline exceeded", err)
	}
}

// Shared assets are staged beside doc.tex.
func TestRender_StagesAssets(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "documents")
	assets := filepath.Join(base, "assets")
	for _, d := range []string{root, filepath.Join(assets, "nested")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(assets, "logo.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "doc.tex.tmpl"), []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The stub fails unless the file is staged and the folder is not.
	stub := strings.Replace(stubBinary, "printf", `test -f "$outdir/logo.png"
test ! -e "$outdir/nested"
printf`, 1)

	r := NewRenderer(root)
	r.xelatexBinary = writeStub(t, stub)
	if _, err := r.Render(context.Background(), "doc.tex.tmpl", nil); err != nil {
		t.Fatalf("render: %v", err)
	}
}

// A staging failure stops the render.
func TestRender_StagingFailures(t *testing.T) {
	tests := []struct {
		name    string
		setup   func(t *testing.T, base string)
		env     string
		wantErr string
	}{
		{
			name:    "assets path is a file",
			wantErr: "not a directory",
			setup: func(t *testing.T, base string) {
				writeFile(t, filepath.Join(base, "assets"), 0o644)
			},
		},
		{
			name:    "asset unreadable",
			wantErr: "permission denied",
			setup: func(t *testing.T, base string) {
				if os.Geteuid() == 0 {
					t.Skip("root reads any file")
				}
				if err := os.MkdirAll(filepath.Join(base, "assets"), 0o755); err != nil {
					t.Fatal(err)
				}
				writeFile(t, filepath.Join(base, "assets", "logo.png"), 0o000)
			},
		},
		{
			name:    "temp dir missing",
			wantErr: "no such file or directory",
			setup:   func(*testing.T, string) {},
			env:     "/nonexistent/pdfgen-tmp",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			base := t.TempDir()
			root := filepath.Join(base, "documents")
			if err := os.MkdirAll(root, 0o755); err != nil {
				t.Fatal(err)
			}
			writeFile(t, filepath.Join(root, "doc.tex.tmpl"), 0o644)
			tc.setup(t, base)
			if tc.env != "" {
				t.Setenv("TMPDIR", tc.env)
			}

			r := NewRenderer(root)
			r.xelatexBinary = writeStub(t, stubBinary)
			_, err := r.Render(context.Background(), "doc.tex.tmpl", nil)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want %q", err, tc.wantErr)
			}
		})
	}
}

func writeFile(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), mode); err != nil {
		t.Fatal(err)
	}
}
