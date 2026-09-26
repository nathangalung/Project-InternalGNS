package queries_test

import (
	"context"
	"sort"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Every query prepares cleanly.
// The SQL is hand-written and parsed at startup, so a renamed column or a
// dropped function surfaces only when a request first runs that query.
// Preparing each block against the migrated test database moves that
// failure to test time, including queries no other test exercises.
func TestStore_EveryQueryPreparesAgainstSchema(t *testing.T) {
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	ctx := context.Background()

	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer conn.Release()

	// The check must be able to fail: a stale column does not prepare.
	if _, err := conn.Conn().Prepare(ctx, "", `SELECT no_such_column FROM users`); err == nil {
		t.Fatal("preparing a missing column succeeded; the check proves nothing")
	}

	names := make([]string, 0, len(store))
	for name := range store {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			sql := store.Get(name)
			if _, err := conn.Conn().Prepare(ctx, "", sql); err != nil {
				t.Fatalf("prepare %s: %v", name, err)
			}
		})
	}
}
