package items_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func newSrv(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.ItemsServer(t, seedUserID)
}

func doJSON(t *testing.T, srv *httptest.Server, method, path string, body any) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

func TestHandler_List(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	assert.NotEmpty(t, rows)
}

func TestHandler_Get(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Get_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/abc", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Get_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/9999999", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Create_HappyPath(t *testing.T) {
	srv := newSrv(t)
	body := items.CreateItemRequest{Name: "API ITEM TEST"}
	res := doJSON(t, srv, http.MethodPost, "/items/", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
}

func TestHandler_Create_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/items/", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Create_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/", items.CreateItemRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Search(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search?q=PUNCHING&minScore=0.05&limit=5", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Search_MissingQ(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Search_BadParams(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search?q=PUNCHING&minScore=junk&limit=zero", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_SearchAdvanced(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search-advanced?q=bearing&limit=5", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	var body items.AdvancedSearchResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	assert.Equal(t, "bearing", body.Query)
	// tier weights guarantee ITEM_AUTO before VENDOR_OFFER before REQUEST_HISTORY.
	for i := 1; i < len(body.Hits); i++ {
		prev, curr := body.Hits[i-1], body.Hits[i]
		assert.True(t, tierGE(prev.Tier, curr.Tier),
			"tier order broken: %s before %s", prev.Tier, curr.Tier)
	}
}

// isActive on a search hit must be the catalog value, so it has to agree with
// what GET /items/{id} reports for the same item.
func TestHandler_SearchAdvanced_IsActiveMatchesCatalog(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search-advanced?q=bearing&limit=5", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	// Decode raw so a missing isActive key is caught, not defaulted to false.
	var body struct {
		Hits []map[string]any `json:"hits"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	require.NotEmpty(t, body.Hits, "seed data must produce at least one hit")

	for _, hit := range body.Hits {
		require.Contains(t, hit, "isActive", "hit must expose isActive")
		id := int64(hit["id"].(float64))

		one := doJSON(t, srv, http.MethodGet, "/items/"+strconv.FormatInt(id, 10), nil)
		var item items.Item
		require.NoError(t, json.NewDecoder(one.Body).Decode(&item))
		one.Body.Close()

		assert.Equal(t, item.IsActive, hit["isActive"],
			"item %d: search says isActive=%v, catalog says %v", id, hit["isActive"], item.IsActive)
	}
}

func TestHandler_SearchAdvanced_MissingQ(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search-advanced", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_SearchAdvanced_BadParams(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search-advanced?q=bearing&minScore=junk&limit=zero", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

// tierGE returns true when a's tier weight >= b's, matching the
// production ordering inside SearchAdvanced.
func tierGE(a, b string) bool {
	rank := map[string]int{
		"ITEM_AUTO":       5,
		"VENDOR_OFFER":    4,
		"ITEM_SUGGESTED":  3,
		"REQUEST_HISTORY": 2,
		"ITEM_FUZZY":      1,
	}
	return rank[a] >= rank[b]
}

func TestHandler_MatchRequest(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRequest{ReqText: "PUNCHING TOOL", Limit: 5}
	res := doJSON(t, srv, http.MethodPost, "/items/match-request", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_MatchRequest_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/items/match-request", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_MatchRequest_EmptyReqText(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/match-request", items.MatchRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_MatchRequest_DefaultLimit(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRequest{ReqText: "ITEM"}
	res := doJSON(t, srv, http.MethodPost, "/items/match-request", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListVendorsForItem(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/vendors", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_ListVendorsForItem_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/abc/vendors", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_PriceHistory(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/price-history?limit=3", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_PriceHistory_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/abc/price-history", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_PriceHistory_DefaultLimit(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/price-history", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_PriceHistory_BadLimitFallback(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/price-history?limit=junk", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_Update_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/items/abc", items.UpdateItemRequest{Name: "X"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/items/1", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Update_EmptyName(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPut, "/items/1", items.UpdateItemRequest{Name: ""})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Update_NotFound(t *testing.T) {
	srv := newSrv(t)
	body := items.UpdateItemRequest{Name: "X", IsActive: true}
	res := doJSON(t, srv, http.MethodPut, "/items/9999999", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_Update_OK(t *testing.T) {
	srv := newSrv(t)
	created := doJSON(t, srv, http.MethodPost, "/items/", items.CreateItemRequest{Name: "UPD ITEM"})
	require.Equal(t, http.StatusCreated, created.StatusCode)
	var it items.Item
	require.NoError(t, json.NewDecoder(created.Body).Decode(&it))
	created.Body.Close()

	body := items.UpdateItemRequest{Name: "UPD ITEM RENAMED", IsActive: true}
	res := doJSON(t, srv, http.MethodPut, "/items/"+itoa(it.ID), body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_AddVendor_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/abc/vendors", items.AddVendorToItemRequest{VendorID: 1})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_AddVendor_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/items/1/vendors", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_AddVendor_MissingVendor(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/1/vendors", items.AddVendorToItemRequest{})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_AddVendor_RepoError(t *testing.T) {
	srv := newSrv(t)
	body := items.AddVendorToItemRequest{VendorID: 9999999}
	res := doJSON(t, srv, http.MethodPost, "/items/9999999/vendors", body)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestHandler_MatchRows_BadJSON(t *testing.T) {
	srv := newSrv(t)
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/items/match-rows", strings.NewReader("?"))
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_MatchRows_Empty(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", items.MatchRowsRequest{})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	assert.Empty(t, out.Rows)
}

func TestHandler_MatchRows_TooManyRows(t *testing.T) {
	srv := newSrv(t)
	rows := make([]items.MatchRowInput, 501)
	for i := range rows {
		rows[i] = items.MatchRowInput{Name: "x"}
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", items.MatchRowsRequest{Rows: rows})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_MatchRows_IMPAExact(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRowsRequest{
		Rows: []items.MatchRowInput{
			{IMPACode: "TF9000001", Name: "Test Fixture Item", Qty: 1, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	require.Len(t, out.Rows, 1)
	require.NotNil(t, out.Rows[0].Matched)
	assert.Equal(t, "IMPA_EXACT", out.Rows[0].Source)
}

func TestHandler_MatchRows_FuzzyFallback(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRowsRequest{
		MinScore: 0.05,
		Rows: []items.MatchRowInput{
			{IMPACode: "", Name: "PUNCHING TOOL SET", Qty: 1, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
}

func TestHandler_MatchRows_NoMatch(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRowsRequest{
		Rows: []items.MatchRowInput{
			{IMPACode: "", Name: "ZZZQQQNOTHINGZZZ", Qty: 1, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	require.Len(t, out.Rows, 1)
	assert.Nil(t, out.Rows[0].Matched)
	assert.Equal(t, "NONE", out.Rows[0].Source)
}

func TestHandler_MatchRows_IMPANotFoundFallsBack(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRowsRequest{
		Rows: []items.MatchRowInput{
			{IMPACode: "NOSUCHIMPA", Name: "ZZZQQQNOTHING", Qty: 1, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}

func TestHandler_PresignImageUpload_StorageUnavailable(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/image/upload-url?fileName=x.png", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
}

func TestHandler_PresignImageDownload_StorageUnavailable(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/1/image/download-url", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
}

func TestHandler_UpdateImage_BadID(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/items/abc/image",
		items.UpdateImageRequest{ObjectKey: "x"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_UpdateImage_EmptyObjectKey(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/items/1/image",
		items.UpdateImageRequest{ObjectKey: " "})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_UpdateImage_NotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPatch, "/items/99999999/image",
		items.UpdateImageRequest{ObjectKey: "items/1/x.png"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

// Import auto-create: unmatched rows become new catalog products, empty price.
func TestHandler_MatchRows_AutoCreate_CreatesProduct(t *testing.T) {
	srv := newSrv(t)
	name := fmt.Sprintf("AutoCreate New Product %d", time.Now().UnixNano())
	body := items.MatchRowsRequest{
		AutoCreate: true,
		MinScore:   0.99, // isolate the no-match -> create path
		Rows: []items.MatchRowInput{
			{IMPACode: "", Name: name, Qty: 2, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	require.Len(t, out.Rows, 1)
	require.NotNil(t, out.Rows[0].Matched, "unmatched row should be auto-created")
	assert.Equal(t, "CREATED", out.Rows[0].Source)
	assert.Greater(t, out.Rows[0].Matched.ItemID, int64(0))
	assert.Nil(t, out.Rows[0].Matched.CostPrice, "new product has empty price")
}

func TestHandler_MatchRows_AutoCreate_DedupsSameName(t *testing.T) {
	srv := newSrv(t)
	base := fmt.Sprintf("Duplicate Import Item %d", time.Now().UnixNano())
	body := items.MatchRowsRequest{
		AutoCreate: true,
		MinScore:   0.99, // first row creates; second dedups within the batch
		Rows: []items.MatchRowInput{
			{Name: base, Qty: 1, Unit: "PCS"},
			{Name: strings.ToLower(base) + " ", Qty: 3, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	require.Len(t, out.Rows, 2)
	require.NotNil(t, out.Rows[0].Matched)
	require.NotNil(t, out.Rows[1].Matched)
	assert.Equal(t, out.Rows[0].Matched.ItemID, out.Rows[1].Matched.ItemID,
		"same normalized name should map to one product")
}

func TestHandler_MatchRows_NoAutoCreate_LeavesNil(t *testing.T) {
	srv := newSrv(t)
	body := items.MatchRowsRequest{
		Rows: []items.MatchRowInput{
			{Name: "Totally Unknown Item QQQ-0000-NoCreate", Qty: 1, Unit: "PCS"},
		},
	}
	res := doJSON(t, srv, http.MethodPost, "/items/match-rows", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var out items.MatchRowsResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	require.Len(t, out.Rows, 1)
	assert.Nil(t, out.Rows[0].Matched, "without autoCreate, unmatched stays nil")
	assert.Equal(t, "NONE", out.Rows[0].Source)
}
