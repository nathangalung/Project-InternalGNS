package items_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// defaultUnitID is the seeded PCS unit.
const defaultUnitID int16 = 19

// uniqueItemName keeps concurrent runs from colliding.
func uniqueItemName(prefix string) string {
	return fmt.Sprintf("%s ITEM %d", prefix, time.Now().UnixNano())
}

// deleteItem removes a row the test created.
func deleteItem(t *testing.T, id int64) {
	t.Helper()
	if id == 0 {
		return
	}
	pool := testutil.Pool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM vendor_products WHERE item_id = $1`, id); err != nil {
		t.Logf("cleanup vendor_products item=%d: %v", id, err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM items WHERE id = $1`, id); err != nil {
		t.Logf("cleanup items id=%d: %v", id, err)
	}
}
