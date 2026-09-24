// Command covercheck gates per-package statement coverage.
//
// It reads one merged profile from `go test -coverpkg=./... -coverprofile`,
// counts every block once even though each test binary repeats it, and
// compares each package with its minimum in the thresholds file. It exits
// non-zero when a package is below its minimum, when a tiered package has no
// measured statements, or when a package is neither tiered nor excluded.
package main

import (
	"bufio"
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
)

// Threshold file model.
type thresholds struct {
	min      map[string]float64
	excludes []string
}

// Coverage totals per package.
type pkgCover struct {
	statements int
	covered    int
}

// Result row per package.
type row struct {
	pkg        string
	percent    float64
	statements int
	covered    int
	min        float64
	status     string
}

const (
	statusOK           = "ok"
	statusBelow        = "BELOW"
	statusMissing      = "NO DATA"
	statusUnclassified = "UNCLASSIFIED"
)

func main() {
	profile := flag.String("profile", "bin/coverage.out", "merged coverage profile")
	thresholdPath := flag.String("thresholds", "scripts/covercheck/thresholds.txt", "per-package minimums")
	gomod := flag.String("gomod", "go.mod", "go.mod that names the module")
	flag.Parse()

	if err := run(os.Stdout, *profile, *thresholdPath, *gomod); err != nil {
		fmt.Fprintln(os.Stderr, "covercheck:", err)
		os.Exit(1)
	}
}

// errGate marks a failed gate, as opposed to an I/O error.
var errGate = errors.New("coverage gate failed")

func run(w io.Writer, profilePath, thresholdPath, gomodPath string) error {
	module, err := readModule(gomodPath)
	if err != nil {
		return err
	}
	th, err := readThresholds(thresholdPath)
	if err != nil {
		return err
	}
	b, err := os.ReadFile(profilePath) //nolint:gosec // operator-supplied path
	if err != nil {
		return fmt.Errorf("read profile: %w", err)
	}
	cover, err := parseProfile(bytes.NewReader(b), module)
	if err != nil {
		return err
	}
	table, failed := report(evaluate(cover, th))
	if _, err := io.WriteString(w, table); err != nil {
		return fmt.Errorf("write report: %w", err)
	}
	if failed > 0 {
		return fmt.Errorf("%w: %d package(s)", errGate, failed)
	}
	return nil
}

// readModule returns the module path in go.mod.
func readModule(p string) (string, error) {
	b, err := os.ReadFile(p) //nolint:gosec // operator-supplied path
	if err != nil {
		return "", fmt.Errorf("read go.mod: %w", err)
	}
	for line := range strings.SplitSeq(string(b), "\n") {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "module "); ok {
			return strings.TrimSpace(rest), nil
		}
	}
	return "", fmt.Errorf("no module line in %s", p)
}

// readThresholds parses "<pkg> <min>" and "exclude <pattern>" lines.
func readThresholds(p string) (thresholds, error) {
	b, err := os.ReadFile(p) //nolint:gosec // operator-supplied path
	if err != nil {
		return thresholds{}, fmt.Errorf("read thresholds: %w", err)
	}
	return parseThresholds(bytes.NewReader(b))
}

func parseThresholds(r io.Reader) (thresholds, error) {
	th := thresholds{min: map[string]float64{}}
	sc := bufio.NewScanner(r)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			return thresholds{}, fmt.Errorf("thresholds line %d: want 2 fields, got %q", n, line)
		}
		if fields[0] == "exclude" {
			th.excludes = append(th.excludes, fields[1])
			continue
		}
		v, err := strconv.ParseFloat(fields[1], 64)
		if err != nil || v < 0 || v > 100 {
			return thresholds{}, fmt.Errorf("thresholds line %d: bad minimum %q", n, fields[1])
		}
		if _, dup := th.min[fields[0]]; dup {
			return thresholds{}, fmt.Errorf("thresholds line %d: duplicate package %q", n, fields[0])
		}
		th.min[fields[0]] = v
	}
	if err := sc.Err(); err != nil {
		return thresholds{}, fmt.Errorf("read thresholds: %w", err)
	}
	return th, nil
}

// Block identity inside a profile.
type blockKey struct {
	file string
	span string
}

type block struct {
	statements int
	covered    bool
}

// parseProfile merges duplicate blocks and totals them per package.
func parseProfile(r io.Reader, module string) (map[string]pkgCover, error) {
	blocks := map[blockKey]block{}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "mode:") {
			continue
		}
		// file:start,end statements count
		colon := strings.LastIndex(line, ":")
		if colon < 0 {
			return nil, fmt.Errorf("profile line %d: malformed %q", n, line)
		}
		fields := strings.Fields(line[colon+1:])
		if len(fields) != 3 {
			return nil, fmt.Errorf("profile line %d: malformed %q", n, line)
		}
		stmts, err1 := strconv.Atoi(fields[1])
		count, err2 := strconv.ParseInt(fields[2], 10, 64)
		if err1 != nil || err2 != nil {
			return nil, fmt.Errorf("profile line %d: malformed %q", n, line)
		}
		key := blockKey{file: line[:colon], span: fields[0]}
		b := blocks[key]
		b.statements = stmts
		b.covered = b.covered || count > 0
		blocks[key] = b
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("read profile: %w", err)
	}

	out := map[string]pkgCover{}
	for k, b := range blocks {
		pkg := strings.TrimPrefix(path.Dir(k.file), module)
		pkg = strings.TrimPrefix(pkg, "/")
		if pkg == "" {
			pkg = "."
		}
		c := out[pkg]
		c.statements += b.statements
		if b.covered {
			c.covered += b.statements
		}
		out[pkg] = c
	}
	return out, nil
}

// excluded reports whether pkg matches any pattern.
// A trailing "/..." matches the directory and everything below it.
func excluded(pkg string, patterns []string) bool {
	for _, p := range patterns {
		if base, ok := strings.CutSuffix(p, "/..."); ok {
			if pkg == base || strings.HasPrefix(pkg, base+"/") {
				return true
			}
			continue
		}
		if ok, _ := path.Match(p, pkg); ok {
			return true
		}
	}
	return false
}

// evaluate classifies every measured and every tiered package.
func evaluate(cover map[string]pkgCover, th thresholds) []row {
	seen := map[string]bool{}
	var rows []row
	for pkg, c := range cover {
		seen[pkg] = true
		if excluded(pkg, th.excludes) {
			continue
		}
		pct := 100.0
		if c.statements > 0 {
			pct = 100 * float64(c.covered) / float64(c.statements)
		}
		m, tiered := th.min[pkg]
		r := row{pkg: pkg, percent: pct, statements: c.statements, covered: c.covered, min: m, status: statusOK}
		switch {
		case !tiered:
			r.status = statusUnclassified
		case float64(c.covered)*100 < m*float64(c.statements):
			r.status = statusBelow
		}
		rows = append(rows, r)
	}
	for pkg, m := range th.min {
		if !seen[pkg] {
			rows = append(rows, row{pkg: pkg, min: m, status: statusMissing})
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].pkg < rows[j].pkg })
	return rows
}

// report renders the table and returns the failure count.
func report(rows []row) (string, int) {
	var b strings.Builder
	failed := 0
	fmt.Fprintf(&b, "%-28s %7s %7s %6s %6s  %s\n", "package", "cover", "min", "gap", "stmts", "status")
	for _, r := range rows {
		gap, need := "", ""
		if r.status == statusBelow {
			gap = fmt.Sprintf("%.1f", r.min-floor1(r.percent))
			need = strconv.Itoa(int(math.Ceil(r.min*float64(r.statements)/100)) - r.covered)
		}
		if r.status != statusOK {
			failed++
		}
		fmt.Fprintf(&b, "%-28s %6.1f%% %6.1f%% %6s %6s  %s\n",
			r.pkg, floor1(r.percent), r.min, gap, need, r.status)
	}
	if failed > 0 {
		b.WriteString("gap: points below the minimum; stmts: statements still to cover\n")
	}
	return b.String(), failed
}

// floor1 truncates to one decimal so 97.96 never prints as 98.0.
func floor1(v float64) float64 {
	return float64(int(v*10)) / 10
}
