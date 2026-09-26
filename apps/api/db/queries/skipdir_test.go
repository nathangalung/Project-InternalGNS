package queries

import (
	"embed"
	"strings"
	"testing"
)

//go:embed testdata/skipdir
var skipDirFS embed.FS

// Directories are skipped, not read.
// The root of this FS holds only the testdata directory, so Load must
// step over it and fail on the missing required blocks. A broken skip
// would instead try to read the directory as a file.
func TestLoad_SkipsDirectories(t *testing.T) {
	saved := FS
	t.Cleanup(func() { FS = saved })
	FS = skipDirFS

	store, err := Load()
	if err == nil {
		t.Fatal("Load over a directory-only FS succeeded")
	}
	if store != nil {
		t.Fatalf("Load returned a store alongside the error: %d blocks", len(store))
	}
	msg := err.Error()
	if strings.Contains(msg, "read testdata") {
		t.Fatalf("Load read the directory instead of skipping it: %v", err)
	}
	if !strings.Contains(msg, "auth.refresh_insert") {
		t.Errorf("error does not come from the required-key check: %v", err)
	}
}
