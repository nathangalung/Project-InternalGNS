package items_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Paging visits each match once.
// It covers MD-09.
func TestHandler_SearchAdvanced_Paging(t *testing.T) {
	const n = 5
	pool := testutil.Pool(t)
	clean := testutil.NewCleaner(t)
	srv := newSrv(t)
	ctx := context.Background()

	token := fmt.Sprintf("Qorvexil%d", time.Now().UnixNano())
	want := map[int64]bool{}
	for i := range n {
		var id int64
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO items (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
			fmt.Sprintf("%s Part %d", token, i), seedUserID).Scan(&id))
		clean.Item(id)
		want[id] = true
	}

	page := func(offset int) items.AdvancedSearchResponse {
		t.Helper()
		path := fmt.Sprintf("/items/search-advanced?q=%s&limit=2&offset=%d", url.QueryEscape(token), offset)
		res := doJSON(t, srv, http.MethodGet, path, nil)
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
		var body items.AdvancedSearchResponse
		require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
		assert.Equal(t, strconv.Itoa(n), res.Header.Get("X-Total-Count"), "offset %d", offset)
		assert.Equal(t, n, body.Total, "body total agrees with the header")
		return body
	}

	seen := map[int64]bool{}
	for offset := 0; offset < n; offset += 2 {
		for _, h := range page(offset).Hits {
			assert.False(t, seen[h.ID], "item %d repeated across pages", h.ID)
			seen[h.ID] = true
		}
	}
	assert.Equal(t, want, seen, "the pages together hold every match")

	past := page(n + 10)
	require.NotNil(t, past.Hits)
	assert.Empty(t, past.Hits)
}

// No offset serves page one.
func TestHandler_SearchAdvanced_DefaultsToFirstPage(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/items/search-advanced?q=bearing&offset=junk", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	total, err := strconv.Atoi(res.Header.Get("X-Total-Count"))
	require.NoError(t, err)
	var body items.AdvancedSearchResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	assert.Equal(t, total, body.Total)
	assert.LessOrEqual(t, len(body.Hits), 20, "default page size")
}
