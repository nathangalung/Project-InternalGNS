package clients_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Inserts one owned client row.
func insertClient(t *testing.T, name, country string, active bool) int64 {
	t.Helper()
	pool := testutil.Pool(t)
	var id int64
	require.NoError(t, pool.QueryRow(context.Background(), `
		INSERT INTO company_client (number, name, country_code, is_active, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
		*freeNumber(t, pool), name, country, active, seedUserID).Scan(&id))
	testutil.NewCleaner(t).Client(id)
	return id
}

// Filters narrow one token's clients.
func TestHandler_List_Filters(t *testing.T) {
	token := fmt.Sprintf("Saring%d", time.Now().UnixNano())
	active := insertClient(t, "PT "+token+" Aktif", "IDN", true)
	inactive := insertClient(t, "PT "+token+" Pasif", "SGP", false)
	srv := newSrv(t)

	cases := []struct {
		name  string
		query string
		want  []int64
	}{
		{"token only", "", []int64{active, inactive}},
		{"isActive=1", "&isActive=1", []int64{active}},
		{"isActive=0", "&isActive=0", []int64{inactive}},
		{"isActive=true", "&isActive=true", []int64{active}},
		{"countryCode", "&countryCode=SGP", []int64{inactive}},
		{"minTotal zero keeps unquoted", "&minTotal=0", []int64{active, inactive}},
		{"minTotal above zero drops unquoted", "&minTotal=0.01", nil},
		{"no match", "&countryCode=ZZZ", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/clients/?q="+url.QueryEscape(token)+c.query, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			raw, err := io.ReadAll(res.Body)
			require.NoError(t, err)
			// An empty page is a JSON array, never null.
			assert.True(t, strings.HasPrefix(string(raw), "["), string(raw))
			var rows []clients.Client
			require.NoError(t, json.Unmarshal(raw, &rows))
			got := make([]int64, 0, len(rows))
			for _, r := range rows {
				got = append(got, r.ID)
			}
			assert.ElementsMatch(t, c.want, got)
			assert.Equal(t, fmt.Sprint(len(c.want)), res.Header.Get("X-Total-Count"))
		})
	}
}

// Non-ASCII names search whole.
func TestHandler_List_UnicodeName(t *testing.T) {
	token := fmt.Sprintf("Çağrı 東京 Ñandú %d", time.Now().UnixNano())
	id := insertClient(t, "PT "+token, "IDN", true)
	res := doJSON(t, newSrv(t), http.MethodGet, "/clients/?q="+url.QueryEscape(token), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []clients.Client
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	require.Len(t, rows, 1)
	assert.Equal(t, id, rows[0].ID)
	assert.Equal(t, "PT "+token, rows[0].Name)
	assert.Equal(t, "1", res.Header.Get("X-Total-Count"))
}

// Unknown country writes nothing.
func TestHandler_Create_UnknownCountry(t *testing.T) {
	name := fmt.Sprintf("PT Negeri Antah %d", time.Now().UnixNano())
	res := doJSON(t, newSrv(t), http.MethodPost, "/clients/",
		clients.CreateClientRequest{Name: name, CountryCode: "ZZZ"})
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))

	var n int
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`SELECT count(*) FROM company_client WHERE name = $1`, name).Scan(&n))
	assert.Zero(t, n)
}
