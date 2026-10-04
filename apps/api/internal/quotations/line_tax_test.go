package quotations_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// quotationTax is the stored header tax.
type quotationTax struct {
	Subtotal, DPP, PPN, GrandTotal string
}

func storedTax(t *testing.T, ctx context.Context, tx pgx.Tx, id int64) quotationTax {
	t.Helper()
	var q quotationTax
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT subtotal::text, dpp_nilai_lain::text, ppn_amount::text, grand_total::text
		FROM quotations WHERE id = $1`, id).Scan(&q.Subtotal, &q.DPP, &q.PPN, &q.GrandTotal))
	return q
}

// lineTax sums the tax line by line.
// It reads quotation_items.subtotal with the v_po_totals formula, so it is
// independent of the functions under test.
func lineTax(t *testing.T, ctx context.Context, tx pgx.Tx, id int64) quotationTax {
	t.Helper()
	var q quotationTax
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT SUM(subtotal)::text,
		       SUM(ROUND(subtotal * 11.0 / 12.0, 2))::text,
		       SUM(ROUND(ROUND(subtotal * 11.0 / 12.0, 2) * 0.12, 2))::text,
		       (SUM(subtotal) + SUM(ROUND(ROUND(subtotal * 11.0 / 12.0, 2) * 0.12, 2)))::text
		FROM quotation_items WHERE quotation_id = $1`, id).Scan(&q.Subtotal, &q.DPP, &q.PPN, &q.GrandTotal))
	return q
}

func centsCreate() quotations.CreateRequest {
	req := sampleCreate()
	ship := "100.01"
	req.ShippingCost = &ship
	req.DiscountPct = "2.5"
	line := req.Items[0]
	req.Items = nil
	for _, l := range []struct{ qty, price string }{{"1", "333.33"}, {"3", "0.97"}, {"7", "1234.57"}} {
		it := line
		it.Qty, it.SellingPrice = l.qty, l.price
		req.Items = append(req.Items, it)
	}
	return req
}

// Quotation tax is per line.
//
// 2.5% off three lines plus shipping leaves cents on every line, where the
// header formula gives DPP 8115.97, PPN 973.92 and Grand Total 9827.71.
// Every writer stores the per-line sums the PO and invoice use instead.
func TestQuotationTax_PerLine(t *testing.T) {
	ctx, repo, tx := newRepo(t)

	id, err := repo.Create(ctx, centsCreate(), seedUserID)
	require.NoError(t, err)
	assert.Equal(t, quotationTax{"8853.79", "8115.98", "973.91", "9827.70"}, storedTax(t, ctx, tx, id))
	assert.Equal(t, lineTax(t, ctx, tx, id), storedTax(t, ctx, tx, id), "create")

	t.Run("whole save", func(t *testing.T) {
		upd := quotations.UpdateRequest{
			ValidityDays:    intPtr(30),
			DiscountPct:     "2.5",
			ShippingAddress: centsCreate().ShippingAddress,
			ShippingCost:    centsCreate().ShippingCost,
			Items:           centsCreate().Items[1:],
		}
		_, err := repo.Update(ctx, id, upd, seedUserID, nil)
		require.NoError(t, err)
		assert.Equal(t, lineTax(t, ctx, tx, id), storedTax(t, ctx, tx, id))
	})

	t.Run("added line", func(t *testing.T) {
		_, err := repo.AddLines(ctx, id, centsCreate().Items[:1], seedUserID)
		require.NoError(t, err)
		assert.Equal(t, quotationTax{"8853.79", "8115.98", "973.91", "9827.70"}, storedTax(t, ctx, tx, id))
	})

	t.Run("revision copies it", func(t *testing.T) {
		require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
		rev, err := repo.Revise(ctx, id, nil, seedUserID)
		require.NoError(t, err)
		assert.Equal(t, storedTax(t, ctx, tx, id), storedTax(t, ctx, tx, rev))
		assert.Equal(t, lineTax(t, ctx, tx, rev), storedTax(t, ctx, tx, rev))
	})

	t.Run("PO agrees", func(t *testing.T) {
		other, err := repo.Create(ctx, centsCreate(), seedUserID)
		require.NoError(t, err)
		require.NoError(t, repo.ChangeStatus(ctx, other, quotations.StatusSent, nil, seedUserID))
		require.NoError(t, repo.ChangeStatus(ctx, other, quotations.StatusAccepted, nil, seedUserID))
		var po quotationTax
		require.NoError(t, tx.QueryRow(ctx, `
			SELECT t.po_subtotal::text, t.po_dpp_nilai_lain::text, t.po_ppn_amount::text, t.po_grand_total::text
			FROM purchase_orders p JOIN v_po_totals t ON t.po_id = p.id
			WHERE p.quotation_id = $1`, other).Scan(&po.Subtotal, &po.DPP, &po.PPN, &po.GrandTotal))
		assert.Equal(t, storedTax(t, ctx, tx, other), po)
	})
}

// A raw insert is one line.
// Seeds and fixtures write the header without lines, so the insert trigger
// taxes its subtotal as a single line.
func TestQuotationTax_RawInsertDefault(t *testing.T) {
	ctx, _, tx := newRepo(t)
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name, contact_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ('SQ-RAW-TAX', $1, 'PT Raw', 'Narahubung', 0, 1000.50, 1000.50, 0, 'draft', 1, 1)
		RETURNING id`, seedCompanyID).Scan(&id))
	assert.Equal(t, quotationTax{"1000.50", "917.13", "110.06", "1110.56"}, storedTax(t, ctx, tx, id))
}
