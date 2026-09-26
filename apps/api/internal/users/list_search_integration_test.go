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

// Search matches text literally.
// LIKE metacharacters in q are data, not wildcards.
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

// NUL search is a 422.
func TestHandler_List_NulSearchIsRefused(t *testing.T) {
	testutil.RequireDB(t)
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodGet, "/users/?q=a%00b", nil)
	defer res.Body.Close()
	assertUnprocessable(t, res, "")
}

// Status filter splits accounts.
// An unparseable value is ignored, matching the other list screens.
func TestHandler_List_FiltersByActiveState(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	tag := fmt.Sprintf("state%d", randSuffix())
	active := newStaff(t, c, srv, tag+"-on@test.local")
	inactive := newStaff(t, c, srv, tag+"-off@test.local")
	res := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/users/%d", inactive.ID), users.UpdateUserRequest{
		Email: inactive.Email, Name: inactive.Name, Role: inactive.Role, IsActive: false,
	})
	require.Equal(t, http.StatusOK, res.StatusCode)
	res.Body.Close()

	tests := []struct {
		isActive string
		want     []int64
	}{
		{"true", []int64{active.ID}},
		{"false", []int64{inactive.ID}},
		{"sometimes", []int64{inactive.ID, active.ID}},
	}
	for _, tc := range tests {
		t.Run(tc.isActive, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, "/users/?sortBy=name&q="+tag+"&isActive="+tc.isActive, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var rows []users.User
			require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
			ids := make([]int64, 0, len(rows))
			for _, r := range rows {
				ids = append(ids, r.ID)
			}
			assert.ElementsMatch(t, tc.want, ids)
			assert.Equal(t, fmt.Sprint(len(tc.want)), res.Header.Get("X-Total-Count"))
		})
	}
}
