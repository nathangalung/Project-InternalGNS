package testutil

import (
	"context"
	"sync"
	"testing"
)

// cleanupPlan orders FK-safe deletes.
// There is one step per tracked table.
var cleanupPlan = []struct {
	key   string
	stmts []string
}{
	// First, since these rows reference clients, items and users.
	{"quotations", []string{
		`DELETE FROM invoices WHERE quotation_id = ANY($1)
		   OR po_id IN (SELECT id FROM purchase_orders WHERE quotation_id = ANY($1))`,
		`DELETE FROM purchase_orders WHERE quotation_id = ANY($1)`,
		`DELETE FROM quotations WHERE id = ANY($1)`,
	}},
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

// Cleaner deletes rows suites created.
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

// Client tracks a company_client row.
func (c *Cleaner) Client(id int64) { c.add("company_client", id) }

// Item tracks an items row.
func (c *Cleaner) Item(id int64) { c.add("items", id) }

// Vendor tracks a vendors row.
func (c *Cleaner) Vendor(id int64) { c.add("vendors", id) }

// Quotation tracks a quotation tree.
// Its PO and invoices are deleted with it; items and history cascade. A
// revision references its parent with RESTRICT, and one DELETE removes the
// whole chain only when every revision id is in it, so a suite that revises
// must track each revision too.
func (c *Cleaner) Quotation(id int64) { c.add("quotations", id) }

// User tracks a users row.
func (c *Cleaner) User(id int64) { c.add("users", id) }

func (c *Cleaner) add(key string, id int64) {
	if id == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ids[key] = append(c.ids[key], id)
}

// run deletes tracked rows.
// Failures are never masked.
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

// reportCleanupErr logs or fails.
// It only logs once the test already failed.
func reportCleanupErr(t testing.TB, format string, args ...any) {
	if t.Failed() {
		t.Logf(format, args...)
		return
	}
	t.Errorf(format, args...)
}
