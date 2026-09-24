package users_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// emailOfLen builds a unique address exactly n characters long.
func emailOfLen(n int) string {
	domain := fmt.Sprintf("@%d.test", randSuffix())
	return strings.Repeat("e", n-len(domain)) + domain
}

// Text the columns cannot store is a 422, never a 500.
// Both columns are VARCHAR(255), which counts characters, not bytes, so a
// multibyte name at the limit still fits.
func TestHandler_Create_TextColumnBounds(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)

	tests := []struct {
		name  string
		email string
		uname string
		want  int
		field string
	}{
		{"name of 255 characters", "", strings.Repeat("n", 255), http.StatusCreated, ""},
		{"multibyte name of 255 characters", "", strings.Repeat("é", 255), http.StatusCreated, ""},
		{"padded name of 255 characters", "", "  " + strings.Repeat("n", 255) + "  ", http.StatusCreated, ""},
		{"name of 256 characters", "", strings.Repeat("n", 256), http.StatusUnprocessableEntity, ""},
		{"name with a NUL byte", "", "Bad\x00Name", http.StatusUnprocessableEntity, ""},
		{"email of 255 characters", emailOfLen(255), "Staff", http.StatusCreated, ""},
		{"email of 256 characters", emailOfLen(256), "Staff", http.StatusUnprocessableEntity, ""},
		{"email with a NUL byte", "bad\x00mail@test.local", "Staff", http.StatusUnprocessableEntity, "email"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			email := tc.email
			if email == "" {
				email = fmt.Sprintf("bounds-%d@test.local", randSuffix())
			}
			res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
				"email": email, "name": tc.uname, "password": validPassword, "role": "operational",
			})
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			if res.StatusCode == http.StatusCreated {
				var u users.User
				require.NoError(t, json.NewDecoder(res.Body).Decode(&u))
				c.User(u.ID)
				assert.Equal(t, strings.TrimSpace(tc.uname), u.Name)
				return
			}
			assertUnprocessable(t, res, tc.field)
		})
	}
}

// Update applies the same bounds.
func TestHandler_Update_TextColumnBounds(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	u := newStaff(t, c, srv, fmt.Sprintf("bounds-upd-%d@test.local", randSuffix()))

	tests := []struct {
		name  string
		email string
		uname string
		field string
	}{
		{"name of 256 characters", u.Email, strings.Repeat("n", 256), ""},
		{"name with a NUL byte", u.Email, "Bad\x00Name", ""},
		{"email of 256 characters", emailOfLen(256), "Staff", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/users/%d", u.ID), map[string]any{
				"email": tc.email, "name": tc.uname, "role": "operational", "isActive": true,
			})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			assertUnprocessable(t, res, tc.field)
		})
	}

	// Nothing was written.
	res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/users/%d", u.ID), nil)
	defer res.Body.Close()
	var got users.User
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, u.Name, got.Name)
	assert.Equal(t, u.Email, got.Email)
}

// assertUnprocessable checks the 422 problem.
// A non-empty field must carry the only field message; an empty one means
// the column refused the value, which the shared mapping words for itself.
func assertUnprocessable(t *testing.T, res *http.Response, field string) {
	t.Helper()
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
	var p struct {
		Detail string            `json:"detail"`
		Fields map[string]string `json:"fields"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	assert.NotEmpty(t, p.Detail)
	assert.NotContains(t, p.Detail, "SQLSTATE")
	if field == "" {
		assert.Empty(t, p.Fields)
		return
	}
	assert.NotEmpty(t, p.Fields[field], "fields=%v", p.Fields)
	assert.Len(t, p.Fields, 1, "fields=%v", p.Fields)
}
