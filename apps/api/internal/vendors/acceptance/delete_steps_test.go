package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Permanent delete steps.

func (s *scenarioState) deleteVendor() error {
	return s.sendRequest(http.MethodDelete, s.vendorPath(""), nil)
}

func (s *scenarioState) problemReads(code, detail string) error {
	var p httperr.Error
	if err := json.Unmarshal(s.body, &p); err != nil {
		return err
	}
	if p.Code != code || p.Detail != detail {
		return fmt.Errorf("want %q %q body=%s", code, detail, s.body)
	}
	return nil
}

// linkVendor offers a new item.
// When quoted, a committed quotation line uses the link.
func (s *scenarioState) linkVendor(quoted bool) error {
	pool := testutil.Pool(s.t)
	ctx := context.Background()
	var itemID, linkID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO items (name, created_by, updated_by) VALUES ($1, 1, 1) RETURNING id`,
		s.uniqueName("ATDD HAPUS ITEM")).Scan(&itemID); err != nil {
		return fmt.Errorf("insert item: %w", err)
	}
	s.cleaner.Item(itemID)
	if err := pool.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 1000, 1, 1) RETURNING id`, s.vendorID, itemID).Scan(&linkID); err != nil {
		return fmt.Errorf("insert link: %w", err)
	}
	if !quoted {
		return nil
	}
	var qid int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        created_by, updated_by)
		VALUES ($1, 1, 'PT. IMC Ship Management', 0, 0, 0, 0, 1, 1) RETURNING id`,
		s.uniqueName("Q-ATDD-HAPUS")).Scan(&qid); err != nil {
		return fmt.Errorf("insert quotation: %w", err)
	}
	// Runs before the Cleaner drops the item and vendor.
	s.t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_status_history WHERE quotation_id = $1`, qid)
		_, _ = pool.Exec(ctx, `DELETE FROM quotations WHERE id = $1`, qid)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
		                             offered_item_id, vendor_product_id, qty,
		                             selling_price, cost_price, discount_pct, created_by)
		VALUES ($1, 1, 'product', 'Barang', $2, $3, 1, 2000, 1000, 0, 1)`,
		qid, itemID, linkID); err != nil {
		return fmt.Errorf("insert line: %w", err)
	}
	return nil
}

func (s *scenarioState) noLinkLeft() error {
	var n int
	err := testutil.Pool(s.t).QueryRow(context.Background(),
		`SELECT COUNT(*) FROM vendor_products WHERE vendor_id = $1`, s.vendorID).Scan(&n)
	if err != nil {
		return err
	}
	if n != 0 {
		return fmt.Errorf("want no links got %d", n)
	}
	return nil
}

func registerDeleteSteps(sc *godog.ScenarioContext, state *scenarioState) {
	sc.Step(`^the user deletes the vendor permanently$`, state.deleteVendor)
	sc.Step(`^the problem is "([^"]+)" reading "([^"]+)"$`, state.problemReads)
	sc.Step(`^the vendor offers a product$`, func() error { return state.linkVendor(false) })
	sc.Step(`^a quotation line uses the vendor$`, func() error { return state.linkVendor(true) })
	sc.Step(`^no product link of the vendor is left$`, state.noLinkLeft)
}
