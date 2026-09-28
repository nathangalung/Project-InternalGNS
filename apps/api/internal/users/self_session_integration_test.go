package users_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// selfCall sends as the signed-in admin.
func selfCall(t *testing.T, repo *users.Repo, actor users.User, method, path string, body any) *http.Response {
	t.Helper()
	signedIn := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), actor.ID)
			ctx = deps.WithUserRole(ctx, string(actor.Role))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	h := users.NewHandler(repo, session.Cookies{})
	r := chi.NewRouter()
	r.Use(signedIn)
	r.Put("/users/{id}", h.Update)
	r.Patch("/users/{id}/password", h.ChangePassword)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

// clearedCookie finds the expiring cookie.
func clearedCookie(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == session.CookieName && c.Value == "" && c.MaxAge < 0 {
			return c
		}
	}
	return nil
}

// Ending one's own session clears it.
// An admin who demotes, deactivates or resets themself ends their own
// sessions, so the response expires the refresh cookie too. Changing
// someone else, or only renaming oneself, leaves the caller's cookie alone.
func TestHandler_SelfRevocationClearsCookie(t *testing.T) {
	cases := []struct {
		name   string
		self   bool
		method string
		path   string
		body   func(u users.User) any
		status int
		clear  bool
	}{
		{"own role change", true, http.MethodPut, "", func(u users.User) any {
			return users.UpdateUserRequest{Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true}
		}, http.StatusOK, true},
		{"own deactivation", true, http.MethodPut, "", func(u users.User) any {
			return users.UpdateUserRequest{Email: u.Email, Name: u.Name, Role: u.Role, IsActive: false}
		}, http.StatusOK, true},
		{"own password reset", true, http.MethodPatch, "/password", func(users.User) any {
			return users.ChangePasswordRequest{Password: "Baru-pw2@"}
		}, http.StatusNoContent, true},
		{"own rename", true, http.MethodPut, "", func(u users.User) any {
			return users.UpdateUserRequest{Email: u.Email, Name: "Renamed", Role: u.Role, IsActive: true}
		}, http.StatusOK, false},
		{"someone else's role change", false, http.MethodPut, "", func(u users.User) any {
			return users.UpdateUserRequest{Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true}
		}, http.StatusOK, false},
		{"someone else's password reset", false, http.MethodPatch, "/password", func(users.User) any {
			return users.ChangePasswordRequest{Password: "Baru-pw2@"}
		}, http.StatusNoContent, false},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			repo := users.NewRepo(tx, testutil.Store(t))
			actor := mkSuperadmin(t, ctx, tx, repo, fmt.Sprintf("self-actor-%d@example.local", i), false)
			other := mkSuperadmin(t, ctx, tx, repo, fmt.Sprintf("self-other-%d@example.local", i), false)
			target := other
			if tc.self {
				target = actor
			}

			res := selfCall(t, repo, actor, tc.method,
				fmt.Sprintf("/users/%d%s", target.ID, tc.path), tc.body(target))
			defer res.Body.Close()
			require.Equal(t, tc.status, res.StatusCode)
			c := clearedCookie(res)
			if !tc.clear {
				assert.Empty(t, res.Header.Values("Set-Cookie"))
				return
			}
			require.NotNil(t, c, "want the refresh cookie expired got %v", res.Header.Values("Set-Cookie"))
			assert.Equal(t, session.CookiePath, c.Path)
			assert.True(t, c.Secure)
			assert.True(t, c.HttpOnly)
		})
	}
}
