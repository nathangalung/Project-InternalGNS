package quotations_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

func boolPtr(b bool) *bool { return &b }

// newVendor inserts an unlinked vendor.
func newVendor(t *testing.T, ctx context.Context, tx pgx.Tx, active bool) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendors (name, is_active, created_by, updated_by)
		VALUES ('AUTOFILL VENDOR ' || clock_timestamp()::text, $1, $2, $2) RETURNING id`,
		active, seedUserID).Scan(&id))
	return id
}

// offered is one complete line.
func offered() quotations.CreateItem {
	return quotations.CreateItem{
		RequestedItemID: int64Ptr(seedItemID),
		RequestedName:   "PUNCHING TOOL SET",
		OfferedItemID:   int64Ptr(seedItemID),
		VendorProductID: int64Ptr(seedVendorProd),
		Qty:             "2",
		UnitID:          seedUnitID,
		SellingPrice:    "1500000",
		CostPrice:       strPtr("1000000"),
	}
}

// noOffer is a request not offered.
func noOffer() quotations.CreateItem {
	return quotations.CreateItem{
		RequestedName:   "BARANG TIDAK ADA",
		VendorProductID: int64Ptr(seedVendorProd),
		Qty:             "1",
		UnitID:          seedUnitID,
		SellingPrice:    "250000",
		CostPrice:       strPtr("200000"),
		IsAvailable:     boolPtr(false),
	}
}

func createWith(t *testing.T, ctx context.Context, repo *quotations.Repo, lines ...quotations.CreateItem) int64 {
	t.Helper()
	req := sampleCreate()
	req.Items = lines
	id, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	return id
}

func detailError(t *testing.T, err error) string {
	t.Helper()
	require.Error(t, err)
	return httperr.FromDBErr(err).Detail
}

// A picked vendor gets linked.
func TestCreate_LinksAnUnlinkedVendor(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	vendor := newVendor(t, ctx, tx, true)
	line := offered()
	line.VendorProductID = nil
	line.VendorID = &vendor
	id := createWith(t, ctx, repo, line)

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	require.NotNil(t, d.Items[0].VendorProductID)
	var linkedVendor int64
	var cost string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT vendor_id, cost_price::text FROM vendor_products WHERE id = $1`,
		*d.Items[0].VendorProductID).Scan(&linkedVendor, &cost))
	assert.Equal(t, vendor, linkedVendor)
	assert.Equal(t, "1000000.00", cost, "a new link starts at the line's cost")
	require.NotNil(t, d.Items[0].VendorID)
	assert.Equal(t, vendor, *d.Items[0].VendorID, "the detail names the vendor")
	require.NotNil(t, d.Items[0].VendorName)
	assert.Contains(t, *d.Items[0].VendorName, "AUTOFILL VENDOR")
}

// Bad vendor picks are refused.
func TestCreate_RefusesBadVendorPicks(t *testing.T) {
	cases := []struct {
		name string
		line func(inactive, active int64) quotations.CreateItem
		want string
	}{
		{"inactive vendor", func(inactive, _ int64) quotations.CreateItem {
			l := offered()
			l.VendorProductID, l.VendorID = nil, &inactive
			return l
		}, "Vendor tidak ditemukan atau sudah nonaktif. Pilih vendor lain."},
		{"vendor without a product", func(_, active int64) quotations.CreateItem {
			l := offered()
			l.VendorProductID, l.VendorID, l.OfferedItemID = nil, &active, nil
			return l
		}, "Pilih produk yang ditawarkan sebelum memilih vendor."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			req := sampleCreate()
			req.Items = []quotations.CreateItem{tc.line(newVendor(t, ctx, tx, false), newVendor(t, ctx, tx, true))}
			_, err := repo.Create(ctx, req, seedUserID)
			assert.Equal(t, tc.want, detailError(t, err))
		})
	}
}

// No-offer lines carry no price.
func TestCreate_NoOfferLineIsUnpriced(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id := createWith(t, ctx, repo, offered(), noOffer())

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	line := d.Items[1]
	assert.False(t, line.IsAvailable)
	assert.Equal(t, "0.00", line.SellingPrice)
	assert.Nil(t, line.VendorProductID)
	assert.Nil(t, line.CostPrice)
	assert.Equal(t, "3000000.00", d.TotalProduk, "only the offered line counts")
}

// Sending needs complete offered lines.
func TestChangeStatus_SendNeedsCompleteLines(t *testing.T) {

	missing := func(edit func(*quotations.CreateItem)) quotations.CreateItem {
		l := offered()
		edit(&l)
		return l
	}
	cases := []struct {
		name  string
		lines []quotations.CreateItem
		want  string
	}{
		{"no vendor", []quotations.CreateItem{missing(func(l *quotations.CreateItem) { l.VendorProductID = nil })},
			"1 baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim."},
		{"no harga beli", []quotations.CreateItem{missing(func(l *quotations.CreateItem) { l.CostPrice = strPtr("0") })},
			"1 baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim."},
		{"no offered product, twice", []quotations.CreateItem{
			missing(func(l *quotations.CreateItem) { l.OfferedItemID = nil }),
			missing(func(l *quotations.CreateItem) { l.SellingPrice = "0" }),
		}, "2 baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id := createWith(t, ctx, repo, tc.lines...)
			err := repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID)
			assert.Equal(t, tc.want, detailError(t, err))
		})
	}

	// An imported line may arrive without its unit; only live AddLines
	// stores one.
	t.Run("no unit", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id := createWith(t, ctx, repo, offered())
		_, err := repo.AddLines(ctx, id,
			[]quotations.CreateItem{missing(func(l *quotations.CreateItem) { l.UnitID = 0 })}, seedUserID)
		require.NoError(t, err)
		err = repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID)
		assert.Equal(t,
			"1 baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim.",
			detailError(t, err))
	})

	t.Run("a no-offer line does not block", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id := createWith(t, ctx, repo, offered(), noOffer())
		require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	})
}

// Sending needs a validity window.
// Without one the quotation never expires and prints no Validity.
func TestChangeStatus_SendNeedsValidity(t *testing.T) {
	draft := func(t *testing.T) (context.Context, *quotations.Repo, int64) {
		t.Helper()
		ctx, repo, _ := newRepo(t)
		req := sampleCreate()
		req.ValidityDays = nil
		id, err := repo.Create(ctx, req, seedUserID)
		require.NoError(t, err)
		return ctx, repo, id
	}

	t.Run("send is refused", func(t *testing.T) {
		ctx, repo, id := draft(t)
		err := repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID)
		assert.Equal(t, "Isi masa berlaku sebelum quotation dikirim.", detailError(t, err))
		assert.Equal(t, "P0014", sqlState(err))
	})

	t.Run("cancel still works", func(t *testing.T) {
		ctx, repo, id := draft(t)
		note := "batal"
		require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusCancelled, &note, seedUserID))
	})
}

// The PO skips no-offer lines.
func TestAccept_LeavesNoOfferLinesOutOfThePO(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id := createWith(t, ctx, repo, offered(), noOffer())
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusAccepted, nil, seedUserID))

	var products, unavailable int
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE poi.item_type = 'product'),
		       count(*) FILTER (WHERE NOT poi.is_available)
		FROM purchase_order_items poi
		JOIN purchase_orders po ON po.id = poi.po_id
		WHERE po.quotation_id = $1`, id).Scan(&products, &unavailable))
	assert.Equal(t, 1, products)
	assert.Zero(t, unavailable)
}

// Nothing offered, nothing accepted.
func TestAccept_RefusesWhenNothingIsOffered(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id := createWith(t, ctx, repo, noOffer())
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	err := repo.ChangeStatus(ctx, id, quotations.StatusAccepted, nil, seedUserID)
	assert.Equal(t,
		"Tidak ada produk yang ditawarkan di quotation ini, jadi tidak ada yang bisa disetujui.",
		detailError(t, err))
}

// A zero-cost link takes the price.
// A link saved before its harga beli was known is filled in by the first
// line that names the vendor with a price; a priced link keeps its own.
func TestCreate_FillsAnUnpricedLink(t *testing.T) {
	cases := []struct {
		name     string
		existing string
		want     string
	}{
		{"unpriced link", "0", "1000000.00"},
		{"priced link", "750000", "750000.00"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			vendor := newVendor(t, ctx, tx, true)
			_, err := tx.Exec(ctx, `
				INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
				VALUES ($1, $2, $3::numeric, 1, 1)`, vendor, seedItemID, tc.existing)
			require.NoError(t, err)
			line := offered()
			line.VendorProductID, line.VendorID = nil, &vendor
			createWith(t, ctx, repo, line)

			var cost string
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT cost_price::text FROM vendor_products WHERE vendor_id = $1 AND item_id = $2`,
				vendor, seedItemID).Scan(&cost))
			assert.Equal(t, tc.want, cost)
		})
	}
}
