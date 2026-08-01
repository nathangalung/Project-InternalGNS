package testutil

import (
	"context"
	"sync"
	"testing"
)

// FK-safe delete plan per tracked table.
var cleanupPlan = []struct {
	key   string
	stmts []string
}{
	{"company_client", []string{
		`DELETE FROM company_contacts WHERE company_id = ANY($1)`,
		`DELETE FROM company_client WHERE id = ANY($1)`,
	}},
	{"items", []string{
		`DELETE FROM vendor_products WHERE item_id = ANY($1)`,
		`DELETE FROM items WHERE id = ANY($1)`,
	}},
	{"vendors", []string{
		`DELETE FROM vendor_products WHERE vendor_id = ANY($1)`,
		`DELETE FROM vendors WHERE id = ANY($1)`,
	}},
	{"users", []string{
		`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`,
		`DELETE FROM users WHERE id = ANY($1)`,
	}},
}

// Cleaner deletes rows an acceptance suite created.
//
// Acceptance suites drive the real HTTP server against the shared dev
// database, so every scenario leaves master data behind. Rows are tracked
// by the id the API returns instead of by name prefix: contacts are named
// by the feature file ("Budi"), so only the parent client id can reach
// them, and an id captured from a POST can never match a developer row.
type Cleaner struct {
	mu  sync.Mutex
	ids map[string][]int64
}

// NewCleaner registers suite teardown.
//
// Call once per suite, before any server is built, so the LIFO t.Cleanup
// order closes the test servers first and deletes afterwards. Teardown
// runs even when a scenario fails.
func NewCleaner(t testing.TB) *Cleaner {
	t.Helper()
	c := &Cleaner{ids: make(map[string][]int64)}
	t.Cleanup(func() { c.run(t) })
	return c
}

// Client tracks a created company_client row.
func (c *Cleaner) Client(id int64) { c.add("company_client", id) }

// Item tracks a created items row.
func (c *Cleaner) Item(id int64) { c.add("items", id) }

// Vendor tracks a created vendors row.
func (c *Cleaner) Vendor(id int64) { c.add("vendors", id) }

// User tracks a created users row.
func (c *Cleaner) User(id int64) { c.add("users", id) }

func (c *Cleaner) add(key string, id int64) {
	if id == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ids[key] = append(c.ids[key], id)
}

// Delete tracked rows without masking failures.
func (c *Cleaner) run(t testing.TB) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Nil when the suite skipped because postgres was unreachable.
	if sharedPool == nil {
		return
	}
	ctx := context.Background()
	for _, step := range cleanupPlan {
		ids := c.ids[step.key]
		if len(ids) == 0 {
			continue
		}
		for _, stmt := range step.stmts {
			if _, err := sharedPool.Exec(ctx, stmt, ids); err != nil {
				reportCleanupErr(t, "acceptance cleanup %q: %v", stmt, err)
				break
			}
		}
	}
}

// Log once the test already failed, else fail.
func reportCleanupErr(t testing.TB, format string, args ...any) {
	if t.Failed() {
		t.Logf(format, args...)
		return
	}
	t.Errorf(format, args...)
}
