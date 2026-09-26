package users_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const validPassword = "Rahasia1!"

// newStaff creates an API account.
func newStaff(t *testing.T, c *testutil.Cleaner, srv *httptest.Server, email string) users.User {
	t.Helper()
	res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
		"email": email, "name": "Staff", "password": validPassword, "role": "operational",
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var u users.User
	require.NoError(t, json.NewDecoder(res.Body).Decode(&u))
	c.User(u.ID)
	return u
}

// Server enforces form password policy.
// AU-9, AU-6: the server enforces the same policy the form shows, and a
// password bcrypt cannot hash is a 422 rather than a 500.
func TestHandler_Create_PasswordAndEmailPolicy(t *testing.T) {
	tests := []struct {
		name     string
		email    string
		password string
		want     int
	}{
		{"valid", "", validPassword, http.StatusCreated},
		{"no uppercase", "", "rahasia1!", http.StatusUnprocessableEntity},
		{"no digit", "", "Rahasiaa!", http.StatusUnprocessableEntity},
		{"no symbol", "", "Rahasia12", http.StatusUnprocessableEntity},
		{"too short", "", "Rah1!", http.StatusUnprocessableEntity},
		{"over 72 bytes", "", "A1!" + strings.Repeat("a", 70), http.StatusUnprocessableEntity},
		{"malformed email", "SCOUT-not-an-email", validPassword, http.StatusUnprocessableEntity},
		{"display name email", "Staff <staff@test.local>", validPassword, http.StatusUnprocessableEntity},
	}
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			email := tc.email
			if email == "" {
				email = fmt.Sprintf("policy-%d@test.local", randSuffix())
			}
			res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
				"email": email, "name": "Policy", "password": tc.password, "role": "operational",
			})
			defer res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)
			if res.StatusCode == http.StatusCreated {
				var u users.User
				require.NoError(t, json.NewDecoder(res.Body).Decode(&u))
				c.User(u.ID)
			}
		})
	}
}

// Reset shares the password policy.
func TestHandler_ChangePassword_SharesPolicy(t *testing.T) {
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	u := newStaff(t, c, srv, fmt.Sprintf("reset-%d@test.local", randSuffix()))

	tests := []struct {
		name     string
		password string
		want     int
	}{
		{"weak", "aaaaaaaa", http.StatusUnprocessableEntity},
		{"over 72 bytes", "A1!" + strings.Repeat("a", 70), http.StatusUnprocessableEntity},
		{"valid", "Berhasil1!", http.StatusNoContent},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPatch,
				fmt.Sprintf("/users/%d/password", u.ID), map[string]any{"password": tc.password})
			defer res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)
		})
	}
}

// Duplicate update email is 409.
// AU-3: an email another user holds is a 409, not a 500.
func TestHandler_Update_DuplicateEmailIsConflict(t *testing.T) {
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	first := newStaff(t, c, srv, fmt.Sprintf("dup-a-%d@test.local", randSuffix()))
	second := newStaff(t, c, srv, fmt.Sprintf("dup-b-%d@test.local", randSuffix()))

	res := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/users/%d", second.ID), map[string]any{
		"email": first.Email, "name": "Dup", "role": "operational", "isActive": true,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusConflict, res.StatusCode)

	var problem struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
	assert.Contains(t, problem.Detail, "Email")
}

// Duplicate message is Indonesian.
// AU-12: the duplicate message on create reaches the UI in Indonesian.
func TestHandler_Create_DuplicateEmailMessageIsIndonesian(t *testing.T) {
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	u := newStaff(t, c, srv, fmt.Sprintf("dup-msg-%d@test.local", randSuffix()))

	res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
		"email": u.Email, "name": "Dup", "password": validPassword, "role": "operational",
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusConflict, res.StatusCode)

	var problem struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
	assert.Equal(t, "Email sudah digunakan pengguna lain.", problem.Detail)
}

// Inactive accounts stay readable.
// AU-5: otherwise nobody can reactivate them.
func TestHandler_Get_InactiveUserIsReadable(t *testing.T) {
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	u := newStaff(t, c, srv, fmt.Sprintf("inactive-%d@test.local", randSuffix()))

	off := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/users/%d", u.ID), map[string]any{
		"email": u.Email, "name": u.Name, "role": "operational", "isActive": false,
	})
	off.Body.Close()
	require.Equal(t, http.StatusOK, off.StatusCode)

	res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/users/%d", u.ID), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var got users.User
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.False(t, got.IsActive)
}

// Create trims name padding.
// AU-13: a padded name must not be stored with its padding.
func TestHandler_Create_TrimsName(t *testing.T) {
	c := testutil.NewCleaner(t)
	srv := newUsersServer(t)
	res := doJSON(t, srv, http.MethodPost, "/users/", map[string]any{
		"email":    fmt.Sprintf("trim-%d@test.local", randSuffix()),
		"name":     "  Nama Berspasi  ",
		"password": validPassword,
		"role":     "operational",
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var u users.User
	require.NoError(t, json.NewDecoder(res.Body).Decode(&u))
	c.User(u.ID)
	assert.Equal(t, "Nama Berspasi", u.Name)
}
