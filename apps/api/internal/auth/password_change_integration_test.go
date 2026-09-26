package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const ownPassword = "Right-pw1!"

// mkOwnSession logs in a user.
// The fresh user has refresh enabled.
func mkOwnSession(t *testing.T) (context.Context, pgx.Tx, *auth.Service, users.User, auth.LoginResponse) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	repo := users.NewRepo(tx, store)
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Own Password", Password: ownPassword, Role: users.RoleFinance,
	}, 1)
	require.NoError(t, err)
	svc := auth.NewService(repo, "own-password-secret", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)
	resp, err := svc.Login(ctx, u.Email, ownPassword)
	require.NoError(t, err)
	return ctx, tx, svc, u, resp
}

// Own password change ends sessions.
// D27: any role can change its own password, which ends every session.
func TestService_ChangeOwnPassword_EndsEverySession(t *testing.T) {
	ctx, _, svc, u, sess := mkOwnSession(t)

	require.NoError(t, svc.ChangeOwnPassword(ctx, u.ID, ownPassword, "Baru-pw2@"))

	_, err := svc.Authenticate(ctx, sess.Token)
	assert.ErrorIs(t, err, auth.ErrSessionRevoked, "the old access token must stop working")
	_, err = svc.Refresh(ctx, sess.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrRevokedRefresh, "the old refresh token must stop working")

	_, err = svc.Login(ctx, u.Email, ownPassword)
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	next, err := svc.Login(ctx, u.Email, "Baru-pw2@")
	require.NoError(t, err)
	_, err = svc.Authenticate(ctx, next.Token)
	require.NoError(t, err, "the re-login right after the change must hold")
}

// Wrong current password counts.
// It changes nothing and counts as a failed guess, so a stolen access token
// cannot grind it without the login backoff.
func TestService_ChangeOwnPassword_WrongCurrentIsRefusedAndCounted(t *testing.T) {
	ctx, tx, svc, u, sess := mkOwnSession(t)

	err := svc.ChangeOwnPassword(ctx, u.ID, "Salah-pw9!", "Baru-pw2@")
	assert.ErrorIs(t, err, auth.ErrWrongCurrentPassword)

	_, err = svc.Authenticate(ctx, sess.Token)
	require.NoError(t, err, "a refused change must not end the session")

	var attempts int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT failed_login_attempts FROM users WHERE id = $1`, u.ID).Scan(&attempts))
	assert.Equal(t, 1, attempts)

	_, err = svc.Login(ctx, u.Email, ownPassword)
	require.NoError(t, err, "the password must be unchanged")
}

// mkPasswordServer mounts auth as u.
// The caller is fixed to u.
func mkPasswordServer(t *testing.T) *httptest.Server {
	t.Helper()
	_, _, svc, u, _ := mkOwnSession(t)
	requireAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(deps.WithUserID(r.Context(), u.ID)))
		})
	}
	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(auth.NewHandler(svc), requireAuth))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func TestHandler_ChangeOwnPassword(t *testing.T) {
	cases := []struct {
		name      string
		body      map[string]string
		wantCode  int
		wantField string
	}{
		{"success", map[string]string{"currentPassword": ownPassword, "newPassword": "Baru-pw2@"}, http.StatusNoContent, ""},
		{"wrong current", map[string]string{"currentPassword": "Salah-pw9!", "newPassword": "Baru-pw2@"}, http.StatusUnprocessableEntity, "currentPassword"},
		{"missing current", map[string]string{"newPassword": "Baru-pw2@"}, http.StatusUnprocessableEntity, "currentPassword"},
		{"weak new", map[string]string{"currentPassword": ownPassword, "newPassword": "aaaaaaaa"}, http.StatusUnprocessableEntity, "newPassword"},
		{"over 72 bytes", map[string]string{"currentPassword": ownPassword, "newPassword": "Aa1!" + string(bytes.Repeat([]byte("x"), 70))}, http.StatusUnprocessableEntity, "newPassword"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := mkPasswordServer(t)
			raw, err := json.Marshal(tc.body)
			require.NoError(t, err)
			req, err := http.NewRequest(http.MethodPatch, srv.URL+"/auth/me/password", bytes.NewReader(raw))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, tc.wantCode, res.StatusCode)
			if tc.wantField == "" {
				return
			}
			var problem struct {
				Fields map[string]string `json:"fields"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
			assert.NotEmpty(t, problem.Fields[tc.wantField])
		})
	}
}
