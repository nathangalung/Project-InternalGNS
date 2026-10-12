package migrations_test

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const offerSnapshotMigration = "00112_quotation_offer_snapshot.sql"

// offerLine is one stored offer.
type offerLine struct {
	name, impa *string
	version    int32
}

// Filed quotations keep their offer.
// Down then Up freezes every line of a quotation past draft at the name and
// IMPA code its product carries now, without bumping the line's version,
// and leaves a draft's lines live. A PO line with no name or code takes
// what it printed before, the product's.
func TestMigration00112_FreezesFiledOffers(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	// 00113 checks the code columns 00112 adds.
	_, err := tx.Exec(ctx, downSQL(t, impaMigration))
	require.NoError(t, err)
	_, err = tx.Exec(ctx, downSQL(t, offerSnapshotMigration))
	require.NoError(t, err)

	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	name, code := "Produk Migrasi "+tag, fmt.Sprintf("98%04d", time.Now().UnixNano()%10_000)
	var item int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by)
		VALUES ($1, $2, 19, 1, 1) RETURNING id`, name, code).Scan(&item))

	repo := quotations.NewRepo(tx, testutil.Store(t))
	create := func() int64 {
		id, err := repo.Create(ctx, quotations.CreateRequest{
			ValidityDays:    testutil.Validity(),
			CompanyClientID: 1,
			DiscountPct:     "0",
			Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
				{RequestedName: "Permintaan " + tag, OfferedItemID: &item, Qty: "1", UnitID: 19, SellingPrice: "1000"},
			}),
		}, 1)
		require.NoError(t, err)
		return id
	}
	move := func(id int64, to ...quotations.Status) {
		for _, s := range to {
			require.NoError(t, repo.ChangeStatus(ctx, id, s, nil, 1))
		}
	}
	draft, sent, accepted := create(), create(), create()
	move(sent, quotations.StatusSent)
	move(accepted, quotations.StatusSent, quotations.StatusAccepted)

	_, err = tx.Exec(ctx, `
		UPDATE purchase_order_items SET item_name = '', item_code = NULL
		WHERE po_id = (SELECT id FROM purchase_orders WHERE quotation_id = $1)`, accepted)
	require.NoError(t, err)

	versions := func(q int64) int32 {
		var v int32
		require.NoError(t, tx.QueryRow(ctx,
			`SELECT row_version FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product'`, q).Scan(&v))
		return v
	}
	before := versions(sent)

	_, err = tx.Exec(ctx, upSQL(t, offerSnapshotMigration))
	require.NoError(t, err)

	read := func(q int64) offerLine {
		var l offerLine
		require.NoError(t, tx.QueryRow(ctx, `
			SELECT offered_name, offered_impa, row_version FROM quotation_items
			WHERE quotation_id = $1 AND item_type = 'product'`, q).Scan(&l.name, &l.impa, &l.version))
		return l
	}
	for _, q := range []int64{sent, accepted} {
		got := read(q)
		require.NotNil(t, got.name, "a filed line is frozen")
		require.NotNil(t, got.impa)
		assert.Equal(t, name, *got.name)
		assert.Equal(t, code, *got.impa)
	}
	assert.Equal(t, before, read(sent).version, "the backfill keeps the line version")
	got := read(draft)
	assert.Nil(t, got.name, "a draft reads the catalog")
	assert.Nil(t, got.impa)

	var poName string
	var poCode *string
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT poi.item_name, poi.item_code FROM purchase_order_items poi
		JOIN purchase_orders po ON po.id = poi.po_id
		WHERE po.quotation_id = $1 AND poi.item_type = 'product'`, accepted).Scan(&poName, &poCode))
	assert.Equal(t, name, poName, "a blank PO name takes the product's")
	require.NotNil(t, poCode)
	assert.Equal(t, code, *poCode)
}
