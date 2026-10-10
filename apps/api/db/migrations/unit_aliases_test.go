package migrations_test

import (
	"context"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const unitAliasesMigration = "00109_unit_aliases.sql"

// unitID reads one unit by code.
func unitID(ctx context.Context, t *testing.T, tx pgx.Tx, code string) int16 {
	t.Helper()
	var id int16
	require.NoError(t, tx.QueryRow(ctx, `SELECT id FROM units WHERE code = $1`, code).Scan(&id))
	return id
}

// PACK folds into PKT.
// Every reference moves to PKT before PACK goes, and the invoice keeps the
// code it printed.
func TestMigration00109_FoldsPackIntoPKT(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qid, err := quotations.NewRepo(tx, testutil.Store(t)).Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Migrasi 00109", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, 1))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, 1))

	// The state before the fold: PACK is a unit and is used everywhere.
	_, err = tx.Exec(ctx, `DELETE FROM unit_aliases WHERE alias = 'PACK'`)
	require.NoError(t, err)
	var pack int16
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO units (code, name, coretax_code) VALUES ('PACK', 'Pack', 'UM.0033') RETURNING id`).Scan(&pack))
	_, err = tx.Exec(ctx, `UPDATE quotation_items SET unit_id = $1 WHERE quotation_id = $2 AND item_type = 'product'`, pack, qid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `
		UPDATE purchase_order_items poi SET unit_id = $1
		FROM purchase_orders po
		WHERE po.id = poi.po_id AND po.quotation_id = $2 AND poi.item_type = 'product'`, pack, qid)
	require.NoError(t, err)
	var item, invoice int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, default_unit_id, created_by, updated_by)
		VALUES ('Migrasi 00109 Pack', $1, 1, 1) RETURNING id`, pack).Scan(&item))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, buyer_name, invoice_date, status, created_by, updated_by)
		VALUES ('INV-MIG-00109', $1, 1, 'PT Pembeli', CURRENT_DATE, 'paid', 1, 1) RETURNING id`, qid).Scan(&invoice))
	_, err = tx.Exec(ctx, `
		INSERT INTO invoice_items (invoice_id, qty, unit_price, line_type, item_name, unit_id, unit_code, created_by)
		VALUES ($1, 1, 1000, 'product', 'Migrasi 00109 Pack', $2, 'PACK', 1)`, invoice, pack)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, upSQL(t, unitAliasesMigration))
	require.NoError(t, err)

	pkt := unitID(ctx, t, tx, "PKT")
	var gone bool
	require.NoError(t, tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM units WHERE code = 'PACK')`).Scan(&gone))
	assert.True(t, gone, "PACK is deleted")

	refs := []struct {
		name  string
		query string
		arg   int64
	}{
		{"item default", `SELECT default_unit_id FROM items WHERE id = $1`, item},
		{"quotation line", `SELECT unit_id FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product'`, qid},
		{"po line", `
			SELECT poi.unit_id FROM purchase_order_items poi
			JOIN purchase_orders po ON po.id = poi.po_id
			WHERE po.quotation_id = $1 AND poi.item_type = 'product'`, qid},
		{"invoice line", `SELECT unit_id FROM invoice_items WHERE invoice_id = $1`, invoice},
	}
	for _, r := range refs {
		t.Run(r.name, func(t *testing.T) {
			var got int16
			require.NoError(t, tx.QueryRow(ctx, r.query, r.arg).Scan(&got))
			assert.Equal(t, pkt, got)
		})
	}

	var printed string
	require.NoError(t, tx.QueryRow(ctx, `SELECT unit_code FROM invoice_items WHERE invoice_id = $1`, invoice).Scan(&printed))
	assert.Equal(t, "PACK", printed, "a filed invoice keeps its printed code")

	var aliasOf int16
	require.NoError(t, tx.QueryRow(ctx, `SELECT unit_id FROM unit_aliases WHERE alias = 'PACK'`).Scan(&aliasOf))
	assert.Equal(t, pkt, aliasOf, "PACK is an alias of PKT")
}

// Ship-supply names and the new units.
func TestMigration00109_NamesAndNewUnits(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	// The names before the cleanup.
	_, err := tx.Exec(ctx, `
		UPDATE units u SET name = v.name
		FROM (VALUES ('TIN', 'Tin/Can'), ('PKT', 'Pack/Packet'), ('BTL', 'Botol/Bottle'),
		             ('PRS', 'Pairs/Pasang'), ('RLS', 'Roll/Gulung'), ('LGH', 'Length/Batang')) v(code, name)
		WHERE u.code = v.code`)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, upSQL(t, unitAliasesMigration))
	require.NoError(t, err)

	want := []struct{ code, name, coretax string }{
		{"PCS", "Piece", "UM.0021"},
		{"LBR", "Lembar", "UM.0020"},
		{"TIN", "Tin", "UM.0033"},
		{"TUB", "Tube", "UM.0033"},
		{"PKT", "Packet", "UM.0033"},
		{"BTL", "Bottle", "UM.0033"},
		{"PRS", "Pairs", "UM.0033"},
		{"RLS", "Rolls", "UM.0033"},
		{"SPL", "Spool", "UM.0033"},
		{"LGH", "Length", "UM.0033"},
		{"COIL", "Coil", "UM.0033"},
		{"PAIL", "Pail", "UM.0033"},
		{"DRUM", "Drum", "UM.0033"},
	}
	for _, w := range want {
		t.Run(w.code, func(t *testing.T) {
			var name, coretax string
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT name, coretax_code FROM units WHERE code = $1`, w.code).Scan(&name, &coretax))
			assert.Equal(t, w.name, name)
			assert.Equal(t, w.coretax, coretax)
		})
	}
}

// One text, one unit.
// An alias is stored normalised and never equals a code, and a code never
// equals an alias.
func TestMigration00109_AliasGuards(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	pcs := unitID(ctx, t, tx, "PCS")

	cases := []struct {
		name    string
		sql     string
		args    []any
		wantErr string
	}{
		{"alias equal to a code", `INSERT INTO unit_aliases (alias, unit_id) VALUES ('PCS', $1)`, []any{pcs}, "kode satuan"},
		{"alias equal to a code once normalised", `INSERT INTO unit_aliases (alias, unit_id) VALUES (' kg. ', $1)`, []any{pcs}, "kode satuan"},
		{"blank alias", `INSERT INTO unit_aliases (alias, unit_id) VALUES (' . ', $1)`, []any{pcs}, "kosong"},
		{"code equal to an alias", `UPDATE units SET code = 'PIECES' WHERE id = $1`, []any{pcs}, "alias"},
		{"new code equal to an alias", `INSERT INTO units (code, name, coretax_code) VALUES ('ea', 'Each', 'UM.0033')`, nil, "alias"},
		{"alias already taken", `INSERT INTO unit_aliases (alias, unit_id) VALUES ('pieces', $1)`, []any{unitID(ctx, t, tx, "SET")}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			sp, err := tx.Begin(ctx)
			require.NoError(t, err)
			defer func() { _ = sp.Rollback(ctx) }()
			_, err = sp.Exec(ctx, c.sql, c.args...)
			require.Error(t, err)
			assert.Contains(t, err.Error(), c.wantErr)
		})
	}

	var stored string
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO unit_aliases (alias, unit_id) VALUES ('  big   bag.. ', $1) RETURNING alias`, pcs).Scan(&stored))
	assert.Equal(t, "BIG BAG", stored)

	var clashes int
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT count(*) FROM unit_aliases a JOIN units u ON fn_unit_text(u.code) = a.alias`).Scan(&clashes))
	assert.Zero(t, clashes)
}

// aliasPairs reads the alias block.
// The block starts at its marker comment and ends at ON CONFLICT.
func aliasPairs(t *testing.T, sql string) []string {
	t.Helper()
	_, block, found := strings.Cut(sql, "-- Unit aliases")
	require.True(t, found, "no alias block")
	block, _, found = strings.Cut(block, "ON CONFLICT")
	require.True(t, found, "alias block has no end")
	re := regexp.MustCompile(`\('([^']+)',\s*'([^']+)'\)`)
	matches := re.FindAllStringSubmatch(block, -1)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		out = append(out, m[1]+"="+m[2])
	}
	sort.Strings(out)
	return out
}

// Seed and migration agree.
// The master seed and the test seed carry the migration's aliases, so a
// fresh database resolves what production resolves.
func TestMigration00109_SeedsCarryAliases(t *testing.T) {
	want := aliasPairs(t, upSQL(t, unitAliasesMigration))
	require.NotEmpty(t, want)

	seed, err := os.ReadFile("../seeds/01_master.sql")
	require.NoError(t, err)
	assert.Equal(t, want, aliasPairs(t, string(seed)), "01_master.sql")

	ctx, tx := testutil.BeginTx(t)
	rows, err := tx.Query(ctx, `
		SELECT a.alias || '=' || u.code FROM unit_aliases a JOIN units u ON u.id = a.unit_id ORDER BY 1`)
	require.NoError(t, err)
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	require.NoError(t, err)
	sort.Strings(got)
	assert.Equal(t, want, got, "test database")
}
