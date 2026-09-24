package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testModule = "example.com/m"

func TestParseProfile(t *testing.T) {
	tests := []struct {
		name    string
		profile string
		want    map[string]pkgCover
		wantErr bool
	}{
		{
			name: "duplicate blocks count once, covered if any binary hit them",
			profile: "mode: atomic\n" +
				"example.com/m/a/x.go:1.1,2.2 3 0\n" +
				"example.com/m/a/x.go:1.1,2.2 3 5\n" +
				"example.com/m/a/x.go:3.1,4.2 2 0\n" +
				"example.com/m/a/x.go:3.1,4.2 2 0\n",
			want: map[string]pkgCover{"a": {statements: 5, covered: 3}},
		},
		{
			name: "files group by package directory",
			profile: "mode: set\n" +
				"example.com/m/a/x.go:1.1,2.2 1 1\n" +
				"example.com/m/a/b/y.go:1.1,2.2 4 0\n" +
				"example.com/m/root.go:1.1,2.2 2 1\n",
			want: map[string]pkgCover{
				"a":   {statements: 1, covered: 1},
				"a/b": {statements: 4},
				".":   {statements: 2, covered: 2},
			},
		},
		{name: "missing colon", profile: "mode: set\nnocolon 1 1\n", wantErr: true},
		{name: "wrong field count", profile: "mode: set\nexample.com/m/a/x.go:1.1,2.2 1\n", wantErr: true},
		{name: "non-numeric count", profile: "mode: set\nexample.com/m/a/x.go:1.1,2.2 1 x\n", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseProfile(strings.NewReader(tc.profile), testModule)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestParseThresholds(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    thresholds
		wantErr bool
	}{
		{
			name: "packages, excludes and comments",
			in:   "# note\n\ninternal/auth 98\nexclude cmd/...\n",
			want: thresholds{min: map[string]float64{"internal/auth": 98}, excludes: []string{"cmd/..."}},
		},
		{name: "one field", in: "internal/auth\n", wantErr: true},
		{name: "not a number", in: "internal/auth high\n", wantErr: true},
		{name: "above 100", in: "internal/auth 101\n", wantErr: true},
		{name: "duplicate package", in: "internal/auth 98\ninternal/auth 90\n", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseThresholds(strings.NewReader(tc.in))
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestExcluded(t *testing.T) {
	patterns := []string{"cmd/...", "internal/*/acceptance", "internal/testutil"}
	tests := []struct {
		pkg  string
		want bool
	}{
		{"cmd", true},
		{"cmd/api", true},
		{"cmdx", false},
		{"internal/auth/acceptance", true},
		{"internal/auth", false},
		{"internal/testutil", true},
		{"internal/testutil/sub", false},
	}
	for _, tc := range tests {
		t.Run(tc.pkg, func(t *testing.T) {
			assert.Equal(t, tc.want, excluded(tc.pkg, patterns))
		})
	}
}

func TestEvaluate(t *testing.T) {
	th := thresholds{
		min:      map[string]float64{"ok": 98, "low": 98, "gone": 90, "empty": 95},
		excludes: []string{"cmd/..."},
	}
	cover := map[string]pkgCover{
		"ok":    {statements: 100, covered: 98},
		"low":   {statements: 10000, covered: 9799},
		"empty": {},
		"new":   {statements: 1, covered: 1},
		"cmd/x": {statements: 5},
	}
	got := evaluate(cover, th)
	status := map[string]string{}
	for _, r := range got {
		status[r.pkg] = r.status
	}
	assert.Equal(t, map[string]string{
		"ok":    statusOK,
		"low":   statusBelow,
		"empty": statusOK,
		"new":   statusUnclassified,
		"gone":  statusMissing,
	}, status)
	assert.Equal(t, "empty", got[0].pkg, "rows are sorted by package")
}

func TestReport(t *testing.T) {
	out, failed := report([]row{
		{pkg: "a", percent: 97.96, statements: 2500, covered: 2449, min: 98, status: statusBelow},
		{pkg: "b", percent: 100, min: 95, status: statusOK},
	})
	assert.Equal(t, 1, failed)
	lines := strings.Split(out, "\n")
	assert.Equal(t, []string{"a", "97.9%", "98.0%", "0.1", "1", "BELOW"}, strings.Fields(lines[1]),
		"percent truncates, never rounds up, and the gap names the statements to cover")
	assert.Equal(t, []string{"b", "100.0%", "95.0%", "ok"}, strings.Fields(lines[2]))

	clean, failed := report([]row{{pkg: "b", percent: 100, min: 95, status: statusOK}})
	assert.Zero(t, failed)
	assert.NotContains(t, clean, "gap:")
}

func TestRun(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(p, []byte(body), 0o600))
		return p
	}
	gomod := write("go.mod", "module example.com/m\n\ngo 1.26\n")
	profile := write("cover.out", "mode: atomic\nexample.com/m/a/x.go:1.1,2.2 2 1\n")
	pass := write("pass.txt", "a 100\n")
	fail := write("fail.txt", "a 100\nb 90\n")

	tests := []struct {
		name       string
		profile    string
		thresholds string
		gomod      string
		wantGate   bool
		wantErr    bool
	}{
		{name: "all packages meet their minimum", profile: profile, thresholds: pass, gomod: gomod},
		{name: "missing package fails the gate", profile: profile, thresholds: fail, gomod: gomod, wantErr: true, wantGate: true},
		{name: "missing profile", profile: filepath.Join(dir, "none"), thresholds: pass, gomod: gomod, wantErr: true},
		{name: "missing thresholds", profile: profile, thresholds: filepath.Join(dir, "none"), gomod: gomod, wantErr: true},
		{name: "missing go.mod", profile: profile, thresholds: pass, gomod: filepath.Join(dir, "none"), wantErr: true},
		{name: "go.mod without module", profile: profile, thresholds: pass, gomod: write("bad.mod", "go 1.26\n"), wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			err := run(&buf, tc.profile, tc.thresholds, tc.gomod)
			if !tc.wantErr {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Equal(t, tc.wantGate, errors.Is(err, errGate))
		})
	}
}
