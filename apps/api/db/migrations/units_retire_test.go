package migrations_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const retiredOTH = "Satuan OTH sudah tidak dipakai. Pilih satuan lain."

// quotationWithLine makes a one line quotation.
// The line starts on PCS, and the quotation is sent when asked.
func quotationWithLine(ctx context.Context, t *testing.T, tx pgx.Tx, name string, send bool) (int64, int64) {
	t.Helper()
	repo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := repo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: name, Qty: "1", UnitID: unitID(ctx, t, tx, "PCS"), SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)
	if send {
		require.NoError(t, repo.ChangeStatus(ctx, qid, "sent", nil, 1))
	}
	var line int64
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT id FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product'`, qid).Scan(&line))
	return qid, line
}

// lineUnit reads a quotation line's unit code.
func lineUnit(ctx context.Context, t *testing.T, tx pgx.Tx, quotationID int64) *string {
	t.Helper()
	var code *string
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT u.code FROM quotation_items qi LEFT JOIN units u ON u.id = qi.unit_id
		WHERE qi.quotation_id = $1 AND qi.item_type = 'product'`, quotationID).Scan(&code))
	return code
}

// refusedAsRetired checks the raise.
func refusedAsRetired(t *testing.T, err error, column string) {
	t.Helper()
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "want a database refusal, got %v", err)
	assert.Equal(t, "P0014", pgErr.Code)
	assert.Equal(t, retiredOTH, pgErr.Message)
	assert.Equal(t, column, pgErr.ColumnName)
}

// CAN apart, OTH retired.
// Down then Up over rows that name OTH: a product default and a draft line
// are cleared, a sent line keeps what the client received, and CAN and
// CANS resolve to the new unit while KALENG stays on TIN.
func TestMigration00122_CanAndRetiredOTH(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	draft, _ := quotationWithLine(ctx, t, tx, "Migrasi 00122 draft", false)
	sent, _ := quotationWithLine(ctx, t, tx, "Migrasi 00122 sent", true)
	beforeCan(ctx, t, tx)

	oth := unitID(ctx, t, tx, "OTH")
	var item int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, default_unit_id, created_by, updated_by)
		VALUES ('Migrasi 00122 produk', $1, 1, 1) RETURNING id`, oth).Scan(&item))
	_, err := tx.Exec(ctx, `
		UPDATE quotation_items SET unit_id = $1
		WHERE quotation_id = ANY($2) AND item_type = 'product'`, oth, []int64{draft, sent})
	require.NoError(t, err)

	_, err = tx.Exec(ctx, upSQL(t, canMigration))
	require.NoError(t, err)

	var def *int16
	require.NoError(t, tx.QueryRow(ctx, `SELECT default_unit_id FROM items WHERE id = $1`, item).Scan(&def))
	assert.Nil(t, def, "a product default on OTH is cleared")
	assert.Nil(t, lineUnit(ctx, t, tx, draft), "a draft line on OTH is cleared")
	require.NotNil(t, lineUnit(ctx, t, tx, sent))
	assert.Equal(t, "OTH", *lineUnit(ctx, t, tx, sent), "a sent line keeps what the client received")

	var active bool
	require.NoError(t, tx.QueryRow(ctx, `SELECT is_active FROM units WHERE code = 'OTH'`).Scan(&active))
	assert.False(t, active, "OTH is retired")

	var can string
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT code || '=' || name || '/' || coretax_code || '/' || is_active::TEXT
		FROM units WHERE code = 'CAN'`).Scan(&can))
	assert.Equal(t, "CAN=Can/UM.0033/true", can)
	for text, code := range map[string]string{"cans": "CAN", "Kaleng": "TIN", "tins": "TIN"} {
		var got string
		require.NoError(t, tx.QueryRow(ctx, `
			SELECT u.code FROM unit_aliases a JOIN units u ON u.id = a.unit_id
			WHERE a.alias = fn_unit_text($1)`, text).Scan(&got), text)
		assert.Equal(t, code, got, text)
	}
}

// A draft line never picks OTH.
func TestRetiredUnit_DraftLineRefused(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	items, err := json.Marshal([]map[string]any{{"unit_id": unitID(ctx, t, tx, "OTH")}})
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `SELECT fn_prepare_quotation_lines($1::jsonb, 1)`, items)
	refusedAsRetired(t, err, "")
}

// A revision asks for a current unit.
// The sent line keeps OTH, its clone starts with none.
func TestRetiredUnit_RevisionDropsIt(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	sent, _ := quotationWithLine(ctx, t, tx, "Revisi satuan lama", true)
	_, err := tx.Exec(ctx, `
		UPDATE quotation_items SET unit_id = $1 WHERE quotation_id = $2`, unitID(ctx, t, tx, "OTH"), sent)
	require.NoError(t, err)

	rev, err := quotations.NewRepo(tx, testutil.Store(t)).Revise(ctx, sent, nil, 1)
	require.NoError(t, err)
	assert.Nil(t, lineUnit(ctx, t, tx, rev), "the revision line has no unit")
	require.NotNil(t, lineUnit(ctx, t, tx, sent))
	assert.Equal(t, "OTH", *lineUnit(ctx, t, tx, sent))
}

// An Ubah PO line keeps OTH, a new one cannot pick it.
func TestRetiredUnit_POLines(t *testing.T) {
	cases := []struct {
		name    string
		keep    bool
		refused bool
	}{
		{"a stored line keeps it", true, false},
		{"a new line is refused", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			qid, _ := quotationWithLine(ctx, t, tx, "PO satuan lama", true)
			require.NoError(t, quotations.NewRepo(tx, testutil.Store(t)).ChangeStatus(ctx, qid, "accepted", nil, 1))
			oth := unitID(ctx, t, tx, "OTH")
			var po, line int64
			require.NoError(t, tx.QueryRow(ctx, `
				UPDATE purchase_order_items poi SET unit_id = $1
				FROM purchase_orders p
				WHERE p.id = poi.po_id AND p.quotation_id = $2 AND poi.item_type = 'product'
				RETURNING p.id, poi.id`, oth, qid).Scan(&po, &line))

			row := map[string]any{"itemName": "PO satuan lama", "qty": "1", "unitId": oth, "sellingPrice": "1000"}
			if tc.keep {
				row["id"] = line
			}
			items, err := json.Marshal([]map[string]any{row})
			require.NoError(t, err)
			_, err = tx.Exec(ctx, `
				SELECT fn_update_po_items($1, 1, 0, NULL, NULL, NULL, NULL, $2::jsonb)`, po, items)
			if tc.refused {
				refusedAsRetired(t, err, "")
				return
			}
			require.NoError(t, err)
		})
	}
}
