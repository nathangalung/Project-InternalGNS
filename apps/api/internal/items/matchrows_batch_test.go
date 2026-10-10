package items_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// countingTx counts Query statements.
// Begin wraps the savepoint, so MatchRows keeps counting inside it.
type countingTx struct {
	pgx.Tx
	n *int
}

func (c countingTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := c.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return countingTx{Tx: tx, n: c.n}, nil
}

func (c countingTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	*c.n++
	return c.Tx.Query(ctx, sql, args...)
}

// brokenTx breaks later result streams.
type brokenTx struct {
	pgx.Tx
	b *testutil.BrokenStreamExec
}

func (b brokenTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := b.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	b.b.Inner = tx
	return brokenTx{Tx: tx, b: b.b}, nil
}

func (b brokenTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return b.b.Query(ctx, sql, args...)
}

// txVendor inserts a vendor inside tx.
func txVendor(t *testing.T, ctx context.Context, tx pgx.Tx, active bool) int64 {
	t.Helper()
	var id int64
	err := tx.QueryRow(ctx, `
		INSERT INTO vendors (name, is_active, created_by, updated_by)
		VALUES ($1, $2, $3, $3) RETURNING id`,
		fmt.Sprintf("Vendor Batch %d", time.Now().UnixNano()), active, seedUserID,
	).Scan(&id)
	require.NoError(t, err)
	return id
}

// A mixed batch keeps per-row results.
// Every row resolves exactly as the old one-statement-per-row path did:
// IMPA wins over the name, a repeated code or name resolves to the same
// item, a code only an inactive item holds is no match, an inactive item
// is never priced, and the price is the cheapest active vendor's.
func TestRepo_MatchRows_MixedBatchKeepsRowResults(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	nonce := time.Now().UnixNano()

	var unitID int16
	var unitCode string
	require.NoError(t, tx.QueryRow(ctx, `SELECT id, code FROM units ORDER BY id LIMIT 1`).Scan(&unitID, &unitCode))

	codeA, codeOld, codeBare, codeMiss := uniqueIMPA(), uniqueIMPA()+"o", uniqueIMPA()+"b", uniqueIMPA()+"m"
	priced, err := repo.Create(ctx, items.CreateItemRequest{
		Name: uniqueItemName("BATCH PRICED"), IMPACode: &codeA, DefaultUnitID: &unitID,
	}, seedUserID)
	require.NoError(t, err)
	cheap, dear, gone := txVendor(t, ctx, tx, true), txVendor(t, ctx, tx, true), txVendor(t, ctx, tx, true)
	for _, v := range []struct {
		id   int64
		cost string
	}{{dear, "300"}, {cheap, "200"}, {gone, "100"}} {
		_, err := repo.AddVendor(ctx, priced.ID, items.AddVendorToItemRequest{VendorID: v.id, CostPrice: &v.cost}, seedUserID)
		require.NoError(t, err)
	}
	// The cheapest link's vendor leaves, so the next one prices the row.
	_, err = tx.Exec(ctx, `UPDATE vendors SET is_active = FALSE WHERE id = $1`, gone)
	require.NoError(t, err)

	retired, err := repo.Create(ctx, items.CreateItemRequest{
		Name: fmt.Sprintf("Barang Pensiun QQZX%dRET", nonce), IMPACode: &codeOld,
	}, seedUserID)
	require.NoError(t, err)
	_, err = repo.Update(ctx, retired.ID, items.UpdateItemRequest{Name: retired.Name, IMPACode: &codeOld, IsActive: false}, seedUserID)
	require.NoError(t, err)

	bare, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("BATCH BARE"), IMPACode: &codeBare}, seedUserID)
	require.NoError(t, err)
	byName, err := repo.Create(ctx, items.CreateItemRequest{Name: fmt.Sprintf("Kunci Pas QQZX%dNAME", nonce)}, seedUserID)
	require.NoError(t, err)

	rows := []items.MatchRowInput{
		{IMPACode: "  " + strings.ToUpper(codeA) + " ", Name: byName.Name, Qty: 1},
		{IMPACode: codeA, Name: "apa saja", Qty: 2},
		{IMPACode: codeOld, Name: fmt.Sprintf("ZZQV%dKOSONG", nonce), Qty: 3},
		{Name: byName.Name, Qty: 4},
		{Name: "  " + strings.ToLower(byName.Name), Qty: 5},
		{Name: fmt.Sprintf("ZZQV%dTIDAKADA", nonce), Qty: 6},
		{IMPACode: codeBare, Qty: 7},
		{Name: retired.Name, Qty: 8},
		{IMPACode: codeMiss, Qty: 9},
	}

	n := 0
	counted := items.NewRepo(countingTx{Tx: tx, n: &n}, testutil.Store(t))
	out, err := counted.MatchRows(ctx, items.MatchRowsRequest{Rows: rows}, 0.5, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, 3, n, "one IMPA, one name and one price statement per chunk")
	require.Len(t, out, len(rows))

	cost := "200.00"
	pricedMatch := &items.MatchedItemWithVendor{
		ItemID: priced.ID, ItemName: priced.Name, IMPACode: priced.IMPACode,
		DefaultUnitID: &unitID, DefaultUnitCode: &unitCode,
		VendorID: &cheap, CostPrice: &cost,
	}
	for i := range 2 {
		require.NotNil(t, out[i].Matched, "row %d", i)
		got := *out[i].Matched
		assert.NotNil(t, got.VendorProductID, "row %d link", i)
		assert.NotNil(t, got.VendorName, "row %d vendor name", i)
		got.VendorProductID, got.VendorName = nil, nil
		assert.Equal(t, *pricedMatch, got, "row %d", i)
		assert.Equal(t, float32(1), out[i].Confidence, "row %d", i)
		assert.Equal(t, "IMPA_EXACT", out[i].Source, "row %d", i)
	}
	assert.Equal(t, out[0].Matched.VendorProductID, out[1].Matched.VendorProductID)

	for _, i := range []int{3, 4} {
		require.NotNil(t, out[i].Matched, "row %d", i)
		assert.Equal(t, byName.ID, out[i].Matched.ItemID, "row %d", i)
		assert.Nil(t, out[i].Matched.VendorID, "row %d has no vendor", i)
		assert.NotEqual(t, "NONE", out[i].Source, "row %d", i)
		assert.Positive(t, out[i].Confidence, "row %d", i)
	}
	assert.Equal(t, out[3].Confidence, out[4].Confidence)
	assert.Equal(t, out[3].Source, out[4].Source)

	require.NotNil(t, out[6].Matched)
	assert.Equal(t, items.MatchedItemWithVendor{ItemID: bare.ID, ItemName: bare.Name, IMPACode: bare.IMPACode}, *out[6].Matched)
	assert.Equal(t, "IMPA_EXACT", out[6].Source)

	for _, i := range []int{2, 5, 7, 8} {
		assert.Equal(t, items.MatchRowResult{Index: i, Requested: rows[i], Source: "NONE"}, out[i], "row %d", i)
	}
	for i, r := range out {
		assert.Equal(t, i, r.Index)
		assert.Equal(t, rows[i], r.Requested)
	}
}

// Statements stay per chunk.
// A miss-only chunk skips the price statement, and a full import costs a
// few statements per chunk whatever its row count.
func TestRepo_MatchRows_StatementsPerChunk(t *testing.T) {
	nonce := time.Now().UnixNano()
	misses := func(n int) []items.MatchRowInput {
		rows := make([]items.MatchRowInput, n)
		for i := range rows {
			rows[i] = items.MatchRowInput{IMPACode: fmt.Sprintf("zq%d-%03d", nonce, i), Name: fmt.Sprintf("ZZQV%03dX%dMISS", i, nonce), Qty: 1}
		}
		return rows
	}
	cases := []struct {
		name string
		rows []items.MatchRowInput
		want int
	}{
		{"one chunk of misses", misses(3), 2},
		{"no codes", []items.MatchRowInput{{Name: fmt.Sprintf("ZZQV%dSOLO", nonce)}}, 1},
		{"five chunks of misses", misses(items.MaxMatchRows), 10},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			n := 0
			repo := items.NewRepo(countingTx{Tx: tx, n: &n}, testutil.Store(t))
			out, err := repo.MatchRows(ctx, items.MatchRowsRequest{Rows: c.rows}, 0.99, seedUserID)
			require.NoError(t, err)
			require.Len(t, out, len(c.rows))
			assert.Equal(t, c.want, n)
		})
	}
}

// Broken streams are not misses.
// A result that fails mid-stream surfaces as an error naming its stage,
// never as an empty lookup that would auto-create a duplicate.
func TestRepo_MatchRows_BrokenStreamIsAnError(t *testing.T) {
	// Statements run IMPA, name, the second row's create, then price.
	cases := []struct {
		name string
		skip int
		want string
	}{
		{"IMPA stream", 0, "match rows 0-1 by IMPA"},
		{"name stream", 1, "match rows 0-1 by name"},
		{"create stream", 2, "create row 1"},
		{"price stream", 3, "price rows 0-1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			store := testutil.Store(t)
			code := uniqueIMPA()
			_, err := items.NewRepo(tx, store).Create(ctx,
				items.CreateItemRequest{Name: uniqueItemName("BROKEN"), IMPACode: &code}, seedUserID)
			require.NoError(t, err)

			b := &testutil.BrokenStreamExec{Inner: tx, Skip: c.skip}
			repo := items.NewRepo(brokenTx{Tx: tx, b: b}, store)
			req := items.MatchRowsRequest{AutoCreate: true, Rows: []items.MatchRowInput{
				{IMPACode: code, Name: "apa saja", Qty: 1},
				{Name: uniqueItemName("BROKEN NEW"), Qty: 1},
			}}
			_, err = repo.MatchRows(ctx, req, 0.99, seedUserID)
			require.ErrorIs(t, err, testutil.ErrFake)
			assert.NotErrorIs(t, err, items.ErrNotFound)
			assert.Contains(t, err.Error(), c.want)
		})
	}
}
