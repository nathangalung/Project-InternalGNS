package pdfgen

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"text/template"
	"time"
)

// Renderer compiles LaTeX templates to PDF bytes via xelatex.
type Renderer struct {
	templatesRoot string
	xelatexBinary string
	timeout       time.Duration
}

// NewRenderer wires the LaTeX templates root.
func NewRenderer(templatesRoot string) *Renderer {
	return &Renderer{
		templatesRoot: templatesRoot,
		xelatexBinary: "xelatex",
		timeout:       45 * time.Second,
	}
}

// Render fills the named template and runs xelatex twice for accurate page refs.
func (r *Renderer) Render(ctx context.Context, name string, data any) ([]byte, error) {
	path := filepath.Join(r.templatesRoot, name)
	tmpl, err := template.New(filepath.Base(path)).
		Delims("[[", "]]").
		Funcs(funcMap()).
		ParseFiles(path)
	if err != nil {
		return nil, fmt.Errorf("parse template: %w", err)
	}

	var rendered bytes.Buffer
	if err := tmpl.ExecuteTemplate(&rendered, filepath.Base(path), data); err != nil {
		return nil, fmt.Errorf("execute template: %w", err)
	}

	dir, err := os.MkdirTemp("", "pdfgen-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	if err := r.copyAssets(dir); err != nil {
		return nil, err
	}

	texPath := filepath.Join(dir, "doc.tex")
	if err := os.WriteFile(texPath, rendered.Bytes(), 0o644); err != nil {
		return nil, err
	}

	for i := 0; i < 2; i++ {
		if err := r.runLatex(ctx, dir, texPath); err != nil {
			return nil, err
		}
	}

	pdf, err := os.ReadFile(filepath.Join(dir, "doc.pdf"))
	if err != nil {
		return nil, fmt.Errorf("pdf not produced: %w", err)
	}
	return pdf, nil
}

// copyAssets stages shared images beside doc.tex.
func (r *Renderer) copyAssets(dir string) error {
	assets := filepath.Join(r.templatesRoot, "..", "assets")
	entries, err := os.ReadDir(assets)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(assets, e.Name()))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, e.Name()), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func (r *Renderer) runLatex(ctx context.Context, dir, texPath string) error {
	cmd := exec.CommandContext(ctx, r.xelatexBinary,
		"-interaction=nonstopmode",
		"-halt-on-error",
		"-output-directory="+dir,
		texPath,
	)
	cmd.Dir = dir
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stdout
	if err := cmd.Run(); err != nil {
		return errors.New("xelatex failed: " + truncate(stdout.String(), 4000))
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "...(truncated)"
}

// LatexEscape escapes user-provided text for safe LaTeX inclusion.
func LatexEscape(s string) string {
	r := strings.NewReplacer(
		"\\", `\textbackslash{}`,
		"&", `\&`,
		"%", `\%`,
		"$", `\$`,
		"#", `\#`,
		"_", `\_`,
		"{", `\{`,
		"}", `\}`,
		"~", `\textasciitilde{}`,
		"^", `\textasciicircum{}`,
		"<", `\textless{}`,
		">", `\textgreater{}`,
		"|", `\textbar{}`,
	)
	return r.Replace(s)
}

// FormatIDR renders a numeric string as Rp 1.234.567 with dot grouping.
func FormatIDR(numericStr string) string {
	if numericStr == "" {
		return "Rp~--"
	}
	negative := false
	s := strings.TrimSpace(numericStr)
	if strings.HasPrefix(s, "-") {
		negative = true
		s = s[1:]
	}
	intPart := s
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		intPart = s[:dot]
	}
	if _, err := strconv.ParseInt(intPart, 10, 64); err != nil {
		return "Rp~--"
	}
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	prefix := "Rp~"
	if negative {
		prefix = "-Rp~"
	}
	return prefix + b.String()
}

// FormatQty trims trailing zeros from a numeric string.
// e.g. "5.00" -> "5", "1.500" -> "1.5", "" -> "0".
func FormatQty(numericStr string) string {
	s := strings.TrimSpace(numericStr)
	if s == "" {
		return "0"
	}
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		s = strings.TrimRight(s, "0")
		s = strings.TrimRight(s, ".")
	}
	if s == "" || s == "-" {
		return "0"
	}
	return s
}

// JakartaDateLine returns "Jakarta, D Month YYYY" in English.
func JakartaDateLine(t time.Time) string {
	months := []string{"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"}
	return fmt.Sprintf("Jakarta, %d %s %d", t.Day(), months[int(t.Month())-1], t.Year())
}

// funcMap exposes helpers inside templates.
func funcMap() template.FuncMap {
	return template.FuncMap{
		"esc": LatexEscape,
		"idr": FormatIDR,
	}
}
