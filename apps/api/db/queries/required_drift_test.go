package queries

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every store.Get("pkg.name") literal must be a RequiredKey. This replaces the
// hand-maintained ledger's blind spot: adding a query and forgetting to list it
// fails here instead of panicking in a handler on the first request.
var storeGetKey = regexp.MustCompile(`store\.Get\("([a-z0-9_]+\.[a-z0-9_]+)"`)

func TestRequiredKeys_CoverAllStoreGetCallSites(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", "..", "internal"))
	if err != nil {
		t.Fatalf("abs: %v", err)
	}

	required := make(map[string]bool, len(RequiredKeys))
	for _, k := range RequiredKeys {
		required[k] = true
	}

	used := make(map[string][]string) // key -> files referencing it
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range storeGetKey.FindAllStringSubmatch(string(src), -1) {
			key := m[1]
			rel, _ := filepath.Rel(root, path)
			used[key] = append(used[key], rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(used) == 0 {
		t.Fatal("found no store.Get call sites; regex or path is wrong")
	}

	for key, files := range used {
		if !required[key] {
			t.Errorf("query %q used in %s but missing from RequiredKeys", key, strings.Join(files, ", "))
		}
	}
}

// Registry matches store and code.
// A block missing from RequiredKeys escapes the boot check, and a key no
// code reads is dead SQL that still has to keep preparing against the
// schema. Both directions fail here rather than drifting silently.
func TestRequiredKeys_MatchStoreAndCallSites(t *testing.T) {
	store, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	required := make(map[string]bool, len(RequiredKeys))
	for _, k := range RequiredKeys {
		if required[k] {
			t.Errorf("RequiredKeys lists %q twice", k)
		}
		required[k] = true
	}
	for name := range store {
		if !required[name] {
			t.Errorf("block %q is not in RequiredKeys", name)
		}
	}

	var src strings.Builder
	for _, dir := range []string{"internal", "cmd"} {
		root, err := filepath.Abs(filepath.Join("..", "..", dir))
		if err != nil {
			t.Fatalf("abs: %v", err)
		}
		err = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			src.Write(b)
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", dir, err)
		}
	}
	code := src.String()
	for _, k := range RequiredKeys {
		if !strings.Contains(code, `"`+k+`"`) {
			t.Errorf("RequiredKeys lists %q but no production code reads it", k)
		}
	}
}
