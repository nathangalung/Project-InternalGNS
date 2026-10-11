package items_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// decodeIMPATaken reads the taken-code 422.
func decodeIMPATaken(t *testing.T, res *http.Response) items.IMPATakenProblem {
	t.Helper()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
	var p items.IMPATakenProblem
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	assert.Equal(t, map[string]string{"impaCode": "Kode IMPA ini sudah dipakai produk aktif lain."}, p.Fields)
	assert.Equal(t, items.IMPATakenCode, p.Code)
	return p
}

// The refusal names the holder.
// Create and update alike carry the active product that owns the code, so
// the user can pick it or rename it instead of hitting a dead end.
func TestHandler_IMPATaken_NamesHolder(t *testing.T) {
	code := uniqueIMPA()
	unit := defaultUnitID
	holder := createItem(t, items.CreateItemRequest{Name: uniqueItemName("PEMEGANG"), IMPACode: ptrS(code), DefaultUnitID: &unit})
	other := createItem(t, items.CreateItemRequest{Name: uniqueItemName("LAIN")})

	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"create", http.MethodPost, "/items/", items.CreateItemRequest{Name: uniqueItemName("BARU"), IMPACode: ptrS(" " + code)}},
		{"update", http.MethodPut, "/items/" + itoa(other.ID), items.UpdateItemRequest{Name: other.Name, IMPACode: ptrS(strings.ToUpper(code)), IsActive: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, newSrv(t), c.method, c.path, c.body)
			defer res.Body.Close()
			p := decodeIMPATaken(t, res)
			require.NotNil(t, p.IMPAHolder)
			assert.Equal(t, items.IMPAHolder{
				ID: holder.ID, Name: holder.Name, IMPACode: strings.ToUpper(code),
				DefaultUnitID: &unit,
			}, *p.IMPAHolder)
		})
	}
}

// The holder keeps its own code.
// Saving the holder with the code it owns is no conflict at all.
func TestHandler_IMPATaken_HolderItselfSaves(t *testing.T) {
	code := uniqueIMPA()
	holder := createItem(t, items.CreateItemRequest{Name: uniqueItemName("SENDIRI"), IMPACode: ptrS(code)})
	res := doJSON(t, newSrv(t), http.MethodPut, "/items/"+itoa(holder.ID),
		items.UpdateItemRequest{Name: holder.Name + " BARU", IMPACode: ptrS(code), IsActive: true})
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

// A failed holder read stays a 422.
// The field message is still true, so the refusal is sent without a holder.
func TestHandler_IMPATaken_HolderReadFails(t *testing.T) {
	code := uniqueIMPA()
	createItem(t, items.CreateItemRequest{Name: uniqueItemName("PEMEGANG"), IMPACode: ptrS(code)})
	srv := mountedSrv(t, &testutil.CountingExec{Inner: testutil.Pool(t), FailAfter: 1})
	res := doJSON(t, srv, http.MethodPost, "/items/", items.CreateItemRequest{Name: uniqueItemName("BARU"), IMPACode: ptrS(code)})
	defer res.Body.Close()
	p := decodeIMPATaken(t, res)
	assert.Nil(t, p.IMPAHolder)
}

// The lookup never returns the item itself.
func TestRepo_IMPAHolder(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	code := uniqueIMPA()
	holder, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("PEMEGANG"), IMPACode: &code}, seedUserID)
	require.NoError(t, err)
	inactive := false
	_, err = repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("PENSIUN"), IMPACode: ptrS(uniqueIMPA()), IsActive: &inactive}, seedUserID)
	require.NoError(t, err)

	cases := []struct {
		name string
		code string
		self int64
		want int64
	}{
		{"another item asks", " " + strings.ToUpper(code), 0, holder.ID},
		{"the holder itself asks", code, holder.ID, 0},
		{"no active holder", uniqueIMPA(), 0, 0},
		{"blank code", "", 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := repo.IMPAHolder(ctx, c.code, c.self)
			if c.want == 0 {
				require.ErrorIs(t, err, items.ErrNotFound)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, c.want, got.ID)
		})
	}
}

// filedUse puts the item on one document.
type filedUse func(t *testing.T, ctx context.Context, tx pgx.Tx, d testutil.QuotationHistory)

// onPOLine adds a PO line for the item.
func onPOLine(t *testing.T, ctx context.Context, tx pgx.Tx, d testutil.QuotationHistory) {
	t.Helper()
	var po int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO purchase_orders (quotation_id, company_client_id, po_date, created_by, discount_pct)
		VALUES ($1, $2, CURRENT_DATE, 1, 0) RETURNING id`, d.Quotations[0], d.Client).Scan(&po))
	_, err := tx.Exec(ctx, `
		INSERT INTO purchase_order_items (po_id, line_number, item_type, offered_item_id, item_name,
		                                  qty, selling_price, created_by, discount_pct)
		VALUES ($1, 1, 'product', $2, $3, 1, 100, 1, 0)`, po, d.Item, d.ItemName)
	require.NoError(t, err)
}

// onInvoiceLine adds an invoice line for the item.
func onInvoiceLine(t *testing.T, ctx context.Context, tx pgx.Tx, d testutil.QuotationHistory) {
	t.Helper()
	var inv int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, invoice_date, created_by, buyer_name)
		VALUES ('INV-UJI-' || $1::bigint, $1::bigint, $2, CURRENT_DATE, 1, 'PT Riwayat') RETURNING id`,
		d.Quotations[0], d.Client).Scan(&inv))
	_, err := tx.Exec(ctx, `
		INSERT INTO invoice_items (invoice_id, line_type, item_name, qty, unit_price, created_by, offered_item_id)
		VALUES ($1, 'product', $2, 1, 100, 1, $3)`, inv, d.ItemName, d.Item)
	require.NoError(t, err)
}

// filedNames reads the PO and invoice lines.
func filedNames(t *testing.T, ctx context.Context, tx pgx.Tx, item int64) []string {
	t.Helper()
	rows, err := tx.Query(ctx, `
		SELECT item_name FROM purchase_order_items WHERE offered_item_id = $1
		UNION ALL
		SELECT item_name FROM invoice_items WHERE offered_item_id = $1`, item)
	require.NoError(t, err)
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	require.NoError(t, err)
	return names
}

// A product is renamed wherever used.
// Every document past draft keeps its own copy of the name, so a rename
// changes only the catalog and the drafts that read it, never a filed
// PO or invoice line.
func TestHandler_Rename_WhereverUsed(t *testing.T) {
	cases := []struct {
		name     string
		statuses []string
		use      filedUse
	}{
		{"no quotation", nil, nil},
		{"draft quotations only", []string{"draft", "draft"}, nil},
		{"sent quotation", []string{"draft", "sent"}, nil},
		{"accepted quotation", []string{"accepted"}, nil},
		{"cancelled quotation", []string{"cancelled"}, nil},
		{"rejected quotation", []string{"rejected"}, nil},
		{"revision quotation", []string{"revision"}, nil},
		{"PO line", []string{"draft"}, onPOLine},
		{"invoice line", []string{"draft"}, onInvoiceLine},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			d := testutil.SeedQuotationHistory(t, ctx, tx, c.statuses...)
			desc := "Keterangan tetap"
			_, err := tx.Exec(ctx, `UPDATE items SET default_unit_id = $2, description = $3 WHERE id = $1`,
				d.Item, defaultUnitID, desc)
			require.NoError(t, err)
			if c.use != nil {
				c.use(t, ctx, tx, d)
			}
			filed := filedNames(t, ctx, tx, d.Item)

			res := doJSON(t, mountedSrv(t, tx), http.MethodPost, "/items/"+itoa(d.Item)+"/rename",
				items.RenameItemRequest{Name: "  Nama Benar " + d.ItemImpa + "  "})
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var got items.Item
			require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
			after, err := items.NewRepo(tx, testutil.Store(t)).GetByID(ctx, d.Item)
			require.NoError(t, err)
			assert.Equal(t, "Nama Benar "+d.ItemImpa, got.Name)
			// JSON and the repo place the same instant in different zones.
			assert.True(t, after.CreatedAt.Equal(got.CreatedAt) && after.UpdatedAt.Equal(got.UpdatedAt))
			after.CreatedAt, after.UpdatedAt = got.CreatedAt, got.UpdatedAt
			assert.Equal(t, after, got)
			require.NotNil(t, got.IMPACode)
			assert.True(t, strings.EqualFold(d.ItemImpa, *got.IMPACode), "the code stays")
			require.NotNil(t, got.DefaultUnitID)
			assert.Equal(t, defaultUnitID, *got.DefaultUnitID)
			require.NotNil(t, got.Description)
			assert.Equal(t, desc, *got.Description)
			assert.True(t, got.IsActive)
			assert.Equal(t, filed, filedNames(t, ctx, tx, d.Item), "filed lines keep their names")
		})
	}
}

// Rename screens its input.
func TestHandler_Rename_Refusals(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	it, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("GANTI")}, seedUserID)
	require.NoError(t, err)
	srv := mountedSrv(t, tx)
	cases := []struct {
		name string
		path string
		body any
		want int
	}{
		{"bad id", "/items/x/rename", items.RenameItemRequest{Name: "A"}, http.StatusBadRequest},
		{"bad body", "/items/" + itoa(it.ID) + "/rename", "{", http.StatusBadRequest},
		{"blank name", "/items/" + itoa(it.ID) + "/rename", items.RenameItemRequest{Name: "   "}, http.StatusUnprocessableEntity},
		{"unknown product", "/items/999999999/rename", items.RenameItemRequest{Name: "A"}, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPost, c.path, c.body)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}

// A failed rename stays generic.
func TestHandler_Rename_Fault(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	d := testutil.SeedQuotationHistory(t, ctx, tx, "sent")
	srv := mountedSrv(t, &testutil.CountingExec{Inner: tx, FailAfter: 0})
	res := doJSON(t, srv, http.MethodPost, "/items/"+itoa(d.Item)+"/rename", items.RenameItemRequest{Name: "A"})
	defer res.Body.Close()
	assertInternalProblem(t, res)
}

// An import reuses the holder.
// A row whose IMPA code an active product holds takes that product, whatever
// its name, and auto-create adds nothing.
func TestHandler_MatchRows_HeldIMPAReusesHolder(t *testing.T) {
	code := uniqueIMPA()
	holder := createItem(t, items.CreateItemRequest{Name: uniqueItemName("PEMEGANG"), IMPACode: ptrS(code)})
	count := func() int {
		var n int
		require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
			`SELECT count(*) FROM items WHERE UPPER(impa_code) = UPPER($1)`, code).Scan(&n))
		return n
	}
	out := matchRows(t, items.MatchRowsRequest{
		AutoCreate: true,
		Rows:       []items.MatchRowInput{{IMPACode: strings.ToUpper(code), Name: "SINGKATAN SALAH " + code, Qty: 1}},
	})
	require.Len(t, out.Rows, 1)
	require.NotNil(t, out.Rows[0].Matched)
	assert.Equal(t, "IMPA_EXACT", out.Rows[0].Source)
	assert.Equal(t, holder.ID, out.Rows[0].Matched.ItemID)
	assert.Equal(t, 1, count(), "no second product with the code")
}
