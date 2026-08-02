package functions

// Drift check for canonical function bodies.

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Regenerate the checked-in bodies.
const updateEnv = "GNS_UPDATE_FUNCTIONS"

// Every project function, extension ones excluded.
const liveFunctionsSQL = `
SELECT p.proname, pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.objid = p.oid
      AND d.classid = 'pg_proc'::regclass
      AND d.deptype = 'e'
  )
ORDER BY p.proname`

const regenHint = "regenerate with: make db-functions-dump"

// TestFunctionBodiesMatchDatabase is the guard that keeps db/functions honest.
// Editing a function in a migration without refreshing the canonical body here
// fails this test, so the directory can never drift into stale documentation.
// testutil.Pool migrates to head first, so a stale database cannot mask drift.
func TestFunctionBodiesMatchDatabase(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()

	rows, err := pool.Query(ctx, liveFunctionsSQL)
	if err != nil {
		t.Fatalf("query pg_proc: %v", err)
	}
	defer rows.Close()

	live := make(map[string]string)
	for rows.Next() {
		var name, def string
		if err := rows.Scan(&name, &def); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if _, dup := live[name]; dup {
			t.Fatalf("function %q is overloaded; one file per name cannot represent it", name)
		}
		live[name] = def
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}
	if len(live) == 0 {
		t.Fatal("found no project functions; the pg_proc filter is wrong")
	}

	dir, err := filepath.Abs(".")
	if err != nil {
		t.Fatalf("abs: %v", err)
	}
	migDir := filepath.Join(dir, "..", "migrations")

	onDisk, err := sqlFiles(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}

	update := os.Getenv(updateEnv) != ""

	for _, name := range sortedKeys(live) {
		path := filepath.Join(dir, name+".sql")
		want := normalize(live[name])

		raw, readErr := os.ReadFile(path)
		if os.IsNotExist(readErr) {
			if !update {
				t.Errorf("function %s exists in the database but %s.sql is missing; %s", name, name, regenHint)
				continue
			}
			raw = nil
		} else if readErr != nil {
			t.Errorf("read %s: %v", path, readErr)
			continue
		}

		header, body := splitHeader(string(raw))

		if update {
			if err := os.WriteFile(path, []byte(render(header, name, migDir, want)), 0o644); err != nil {
				t.Fatalf("write %s: %v", path, err)
			}
			continue
		}

		if got := normalize(body); got != want {
			t.Errorf("%s.sql is stale: %s\n%s", name, firstDiff(got, want), regenHint)
		}
	}

	for _, f := range onDisk {
		name := strings.TrimSuffix(f, ".sql")
		if _, ok := live[name]; ok {
			continue
		}
		if update {
			if err := os.Remove(filepath.Join(dir, f)); err != nil {
				t.Fatalf("remove %s: %v", f, err)
			}
			continue
		}
		t.Errorf("%s has no matching function in the database; the function was dropped, so delete this file", f)
	}
}

// sqlFiles lists the checked-in bodies.
func sqlFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// normalize strips only cosmetic whitespace.
func normalize(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.Trim(strings.Join(lines, "\n"), "\n")
}

// splitHeader separates leading comments from the definition.
func splitHeader(content string) ([]string, string) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	i := 0
	for i < len(lines) {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			i++
			continue
		}
		break
	}
	return lines[:i], strings.Join(lines[i:], "\n")
}

// render rebuilds a file, keeping hand-written prose.
func render(header []string, name, migDir, def string) string {
	var b strings.Builder
	b.WriteString("-- Canonical current body of " + name)
	if mig := migrationFor(migDir, name); mig != "" {
		b.WriteString(" (deployed by migration " + mig + ")")
	}
	b.WriteString(".\n")
	// Keep hand-written prose verbatim, blank lines included.
	for _, l := range header[min(1, len(header)):] {
		b.WriteString(strings.TrimRight(l, " \t") + "\n")
	}
	b.WriteString(def + "\n")
	return b.String()
}

var (
	gooseUp   = regexp.MustCompile(`(?m)^--\s*\+goose\s+Up\b`)
	gooseDown = regexp.MustCompile(`(?m)^--\s*\+goose\s+Down\b`)
)

// migrationFor finds the newest migration defining name.
func migrationFor(migDir, name string) string {
	re := regexp.MustCompile(`(?is)CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?` +
		regexp.QuoteMeta(name) + `\s*\(`)

	entries, err := os.ReadDir(migDir)
	if err != nil {
		return ""
	}
	last := ""
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		src, err := os.ReadFile(filepath.Join(migDir, e.Name()))
		if err != nil {
			continue
		}
		if re.MatchString(upSection(string(src))) {
			last = e.Name()
		}
	}
	if last == "" {
		return ""
	}
	return strings.SplitN(last, "_", 2)[0]
}

// upSection keeps the goose Up half.
func upSection(src string) string {
	if loc := gooseUp.FindStringIndex(src); loc != nil {
		src = src[loc[1]:]
	}
	if loc := gooseDown.FindStringIndex(src); loc != nil {
		src = src[:loc[0]]
	}
	return src
}

// firstDiff reports the first differing line.
func firstDiff(got, want string) string {
	g := strings.Split(got, "\n")
	w := strings.Split(want, "\n")
	for i := 0; i < len(g) && i < len(w); i++ {
		if g[i] != w[i] {
			return "line " + strconv.Itoa(i+1) + "\n  file:     " + g[i] + "\n  database: " + w[i]
		}
	}
	return "file has " + strconv.Itoa(len(g)) + " body lines, database has " + strconv.Itoa(len(w))
}
