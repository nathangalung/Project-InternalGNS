package users_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// A search matches its text literally: LIKE metacharacters in q are data.
func TestHandler_List_SearchIsLiteral(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	tag := fmt.Sprintf("lit%d", randSuffix())
	for _, suffix := range []string{"a_b", "axb", "c%d", "cxd", `e\f`, "ef"} {
		res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
			"email":    fmt.Sprintf("%s-%d@test.local", tag, randSuffix()),
			"name":     tag + " " + suffix,
			"password": validPassword,
			"role":     "operational",
		})
		require.Equal(t, http.StatusCreated, res.StatusCode)
		var u users.User
		require.NoError(t, json.NewDecoder(res.Body).Decode(&u))
		res.Body.Close()
		c.User(u.ID)
	}

	tests := []struct {
		name string
		q    string
		want string
	}{
		{"underscore", tag + " a_b", tag + " a_b"},
		{"percent", tag + " c%d", tag + " c%d"},
		{"backslash", tag + ` e\f`, tag + ` e\f`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/users/?q="+url.QueryEscape(tc.q), nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var rows []users.User
			require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
			names := make([]string, 0, len(rows))
			for _, r := range rows {
				names = append(names, r.Name)
			}
			assert.Equal(t, []string{tc.want}, names)
			assert.Equal(t, "1", res.Header.Get("X-Total-Count"))
		})
	}
}

// A NUL byte in the search is a 4xx problem, never a 500.
func TestHandler_List_NulSearchIsRefused(t *testing.T) {
	testutil.RequireDB(t)
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/?q=a%00b", nil)
	defer res.Body.Close()
	assertUnprocessable(t, res, "")
}
