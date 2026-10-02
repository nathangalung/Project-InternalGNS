package testutil

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// QuotationHistory is one product's quotations.
// Every quotation is for Client and offers Item from Vendor; Quotations
// holds their ids oldest first, in the order of the statuses given.
type QuotationHistory struct {
	Client     int64
	Contact    string
	Item       int64
	ItemName   string
	ItemImpa   string
	Vendor     int64
	VendorName string
	Quotations []int64
}

// SeedQuotationHistory writes one quotation per status.
// Each is a day newer than the last and carries one offered line (qty 2,
// harga beli 100, harga jual 150 + its position) plus one line marked Tidak
// Ditawarkan for the same product, which recent lists must leave out.
func SeedQuotationHistory(t testing.TB, ctx context.Context, exec db.Executor, statuses ...string) QuotationHistory {
	t.Helper()
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	d := QuotationHistory{
		Contact:    "Narahubung " + tag,
		ItemName:   "Barang Riwayat " + tag,
		ItemImpa:   tag[len(tag)-6:],
		VendorName: "CV Riwayat " + tag,
	}
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES (fn_next_client_number(), $1, 'IDN', 1, 1) RETURNING id`, "PT Riwayat "+tag).Scan(&d.Client))
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO items (name, impa_code, created_by, updated_by)
		VALUES ($1, $2, 1, 1) RETURNING id`, d.ItemName, d.ItemImpa).Scan(&d.Item))
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO vendors (name, is_active, created_by, updated_by)
		VALUES ($1, TRUE, 1, 1) RETURNING id`, d.VendorName).Scan(&d.Vendor))
	var link int64
	require.NoError(t, exec.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 100, 1, 1) RETURNING id`, d.Vendor, d.Item).Scan(&link))
	start := time.Now().Add(-time.Duration(len(statuses)+1) * 24 * time.Hour)
	for i, status := range statuses {
		var id int64
		require.NoError(t, exec.QueryRow(ctx, `
			INSERT INTO quotations (quotation_no, company_client_id, company_client_name, contact_name,
			                        discount_pct, total_produk, total, total_discount,
			                        status, created_by, updated_by, created_at)
			VALUES ($1, $2, 'PT Riwayat', $3, 0, 300, 300, 0, $4, 1, 1, $5) RETURNING id`,
			"SQ-RIWAYAT-"+tag+"-"+strconv.Itoa(i), d.Client, d.Contact, status,
			start.Add(time.Duration(i)*24*time.Hour)).Scan(&id))
		_, err := exec.Exec(ctx, `
			INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name, offered_item_id,
			                             vendor_product_id, qty, unit_id, selling_price, cost_price,
			                             is_available, discount_pct, created_by)
			SELECT $1, n, 'product', $2, $3, CASE WHEN n = 1 THEN $4::bigint END, 2,
			       (SELECT id FROM units ORDER BY id LIMIT 1),
			       CASE WHEN n = 1 THEN 150 + $5 ELSE 0 END, CASE WHEN n = 1 THEN 100 END,
			       n = 1, 0, 1
			FROM generate_series(1, 2) n`, id, d.ItemName, d.Item, link, i)
		require.NoError(t, err)
		d.Quotations = append(d.Quotations, id)
	}
	return d
}
