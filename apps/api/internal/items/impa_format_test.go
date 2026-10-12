package items_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Saves store a code once.
// Create, update and rename keep the code in its field as six digits and
// out of the name; a name marking a free code moves it into an empty
// field, and one another product holds stays in the name.
func TestHandler_SavesStoreCodeOnce(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	srv := mountedSrv(t, tx)
	repo := items.NewRepo(tx, testutil.Store(t))
	held := uniqueIMPA(t)
	_, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("PEMEGANG"), IMPACode: &held}, seedUserID)
	require.NoError(t, err)

	code, free := uniqueIMPA(t), uniqueIMPA(t)
	base := uniqueItemName("RANTAI")
	save := func(method, path string, body any) items.Item {
		t.Helper()
		res := doJSON(t, srv, method, path, body)
		defer res.Body.Close()
		require.Less(t, res.StatusCode, 300, path)
		var it items.Item
		require.NoError(t, json.NewDecoder(res.Body).Decode(&it))
		return it
	}

	created := save(http.MethodPost, "/items/",
		items.CreateItemRequest{Name: code + " - " + base, IMPACode: new("IMPA " + code)})
	assert.Equal(t, base, created.Name)
	require.NotNil(t, created.IMPACode)
	assert.Equal(t, code, *created.IMPACode)

	updated := save(http.MethodPut, "/items/"+itoa(created.ID),
		items.UpdateItemRequest{Name: base + " (IMPA " + code + ")", IMPACode: new(code), IsActive: true})
	assert.Equal(t, base, updated.Name)

	renamed := save(http.MethodPost, "/items/"+itoa(created.ID)+"/rename",
		items.RenameItemRequest{Name: base + " BARU IMPA" + code})
	assert.Equal(t, base+" BARU", renamed.Name)

	moved := save(http.MethodPost, "/items/", items.CreateItemRequest{Name: base + " LAIN IMPA " + free})
	assert.Equal(t, base+" LAIN", moved.Name)
	require.NotNil(t, moved.IMPACode)
	assert.Equal(t, free, *moved.IMPACode)

	kept := save(http.MethodPost, "/items/", items.CreateItemRequest{Name: base + " KETIGA IMPA " + held})
	assert.Equal(t, base+" KETIGA IMPA "+held, kept.Name, "a held code stays where it was typed")
	assert.Nil(t, kept.IMPACode)
}

// Saves refuse a bad code.
func TestHandler_SavesRefuseBadCode(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	srv := mountedSrv(t, tx)
	it, err := items.NewRepo(tx, testutil.Store(t)).Create(ctx, items.CreateItemRequest{Name: uniqueItemName("SALAH")}, seedUserID)
	require.NoError(t, err)
	cases := []struct {
		name, method, path string
		body               any
	}{
		{"create", http.MethodPost, "/items/", items.CreateItemRequest{Name: "A", IMPACode: new("19010")}},
		{"update", http.MethodPut, "/items/" + itoa(it.ID), items.UpdateItemRequest{Name: "A", IMPACode: new("ABC123"), IsActive: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, c.body)
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var p struct {
				Fields map[string]string `json:"fields"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, map[string]string{"impaCode": validate.IMPAMessage}, p.Fields)
		})
	}
}

// Code queries find the holder.
// Search by code, marked or bare, never returns another product whose
// name or code merely resembles it.
func TestHandler_SearchAdvanced_CodeFindsHolderOnly(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := items.NewRepo(tx, testutil.Store(t))
	code := uniqueIMPA(t)
	holder, err := repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("PEMILIK"), IMPACode: &code}, seedUserID)
	require.NoError(t, err)
	// One digit off, which trigram similarity used to find.
	near := code[:5] + string('0'+(code[5]-'0'+1)%10)
	_, err = repo.Create(ctx, items.CreateItemRequest{Name: uniqueItemName("TETANGGA"), IMPACode: &near}, seedUserID)
	require.NoError(t, err)

	srv := mountedSrv(t, tx)
	for _, q := range []string{code, "IMPA " + code, "(IMPA" + code + ")"} {
		t.Run(q, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/items/search-advanced?q="+url.QueryEscape(q), nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var out items.AdvancedSearchResponse
			require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
			require.Len(t, out.Hits, 1)
			assert.Equal(t, holder.ID, out.Hits[0].ID)
			assert.Equal(t, "ITEM_AUTO", out.Hits[0].Tier)
		})
	}
}
