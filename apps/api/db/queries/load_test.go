package queries

import (
	"embed"
	"strings"
	"testing"
)

// Missing SQL fails the boot.
// Load is the boot check: a missing block must fail it by name, not
// panic in a handler on the first request that needs it.
func TestLoad_MissingBlocksFailTheBoot(t *testing.T) {
	saved := FS
	t.Cleanup(func() { FS = saved })
	FS = embed.FS{}

	store, err := Load()
	if err == nil {
		t.Fatal("Load with no SQL files succeeded")
	}
	if store != nil {
		t.Fatalf("Load returned a store alongside the error: %d blocks", len(store))
	}
	for _, k := range []string{"auth.refresh_insert", "users.get_by_id", "vendors.update_logo"} {
		if !strings.Contains(err.Error(), k) {
			t.Errorf("error does not name missing block %q: %v", k, err)
		}
	}
}
