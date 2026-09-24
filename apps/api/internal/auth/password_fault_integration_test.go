package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const newOwnPassword = "Sendiri-pw3#"

// Refusals of a self-service change.
// Each one leaves the current password in place.
func TestService_ChangeOwnPassword_Refusals(t *testing.T) {
	tests := []struct {
		name       string
		overrides  map[string]string
		current    string
		deactivate bool
		want       error
	}{
		{"account deactivated", nil, faultPassword, true, auth.ErrSessionRevoked},
		{"account closed before the throttle read",
			map[string]string{"users.lock_status": noLockRow}, faultPassword, false, auth.ErrSessionRevoked},
		{"miss bookkeeping fails",
			map[string]string{"users.record_failed_login": failingSQL["users.record_failed_login"]},
			"Salah-pw9!", false, auth.ErrWrongCurrentPassword},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, u := faultAccount(t)
			if tc.deactivate {
				_, err := tx.Exec(ctx, `UPDATE users SET is_active = FALSE WHERE id = $1`, u.ID)
				require.NoError(t, err)
			}
			err := svcOn(tx, storeWith(t, tc.overrides)).ChangeOwnPassword(ctx, u.ID, tc.current, newOwnPassword)
			assert.ErrorIs(t, err, tc.want)
		})
	}
}

// A storage failure is an error.
// A failure inside the claim-and-write transaction also leaves the old
// password working.
func TestService_ChangeOwnPassword_StorageFailuresSurface(t *testing.T) {
	tests := []struct {
		key   string
		outer bool
	}{
		{"users.get_by_id", true},
		{"users.lock_status", true},
		{"users.reset_login_attempts", false},
	}
	for _, tc := range tests {
		t.Run(tc.key, func(t *testing.T) {
			ctx, tx, u := faultAccount(t)
			err := svcOn(tx, failing(t, tc.key)).ChangeOwnPassword(ctx, u.ID, faultPassword, newOwnPassword)
			requireDBFault(t, err)
			if tc.outer {
				return
			}
			_, err = svcOn(tx, testutil.Store(t)).Login(ctx, u.Email, faultPassword)
			assert.NoError(t, err, "the old password must still work")
		})
	}
}

// A deactivation beats self-service change.
// The change verified the password, then the account was switched off
// before its claim: that is a dead session, not a password conflict.
func TestService_ChangeOwnPassword_LosesToAConcurrentDeactivation(t *testing.T) {
	svc, u := committedUser(t)

	holder := holdUserRow(t, u.ID)
	done := make(chan struct{})
	var changeErr error
	go func() {
		defer close(done)
		changeErr = svc.ChangeOwnPassword(context.Background(), u.ID, racePassword, newOwnPassword)
	}()

	waitBlockedOn(t, holder, done)
	_, err := holder.Exec(context.Background(), `UPDATE users SET is_active = FALSE WHERE id = $1`, u.ID)
	require.NoError(t, err)
	require.NoError(t, holder.Commit(context.Background()))
	<-done

	assert.ErrorIs(t, changeErr, auth.ErrSessionRevoked)
	var hash string
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`SELECT password_hash FROM users WHERE id = $1`, u.ID).Scan(&hash))
	assert.Equal(t, u.PasswordHash, hash, "the refused change must not write")
}

// authServerOn mounts the auth routes on store.
// A zero userID leaves the request anonymous.
func authServerOn(t *testing.T, store queries.Store, userID func() int64) *httptest.Server {
	t.Helper()
	_, tx, u := faultAccount(t)
	svc := svcOn(tx, store)
	id := u.ID
	if userID != nil {
		id = userID()
	}
	requireAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if id != 0 {
				r = r.WithContext(deps.WithUserID(r.Context(), id))
			}
			next.ServeHTTP(w, r)
		})
	}
	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(auth.NewHandler(svc), requireAuth))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func send(t *testing.T, srv *httptest.Server, method, path, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func ownChangeBody(t *testing.T, current string) string {
	t.Helper()
	raw, err := json.Marshal(auth.ChangeOwnPasswordRequest{CurrentPassword: current, NewPassword: newOwnPassword})
	require.NoError(t, err)
	return string(raw)
}

// Self-service change status mapping.
func TestHandler_ChangeOwnPassword_Refusals(t *testing.T) {
	anonymous := func() int64 { return 0 }
	gone := func() int64 { return 99_999_999 }
	tests := []struct {
		name       string
		store      func(t *testing.T) queries.Store
		userID     func() int64
		body       string
		wantStatus int
		wantDetail string
	}{
		{"anonymous", func(t *testing.T) queries.Store { return testutil.Store(t) }, anonymous,
			ownChangeBody(t, faultPassword), http.StatusUnauthorized, auth.DetailNotSignedIn},
		{"malformed json", func(t *testing.T) queries.Store { return testutil.Store(t) }, nil,
			`{"currentPassword":`, http.StatusBadRequest, "invalid json"},
		{"account gone", func(t *testing.T) queries.Store { return testutil.Store(t) }, gone,
			ownChangeBody(t, faultPassword), http.StatusUnauthorized, auth.DetailSessionRevoked},
		{"storage failure", func(t *testing.T) queries.Store { return failing(t, "users.reset_login_attempts") }, nil,
			ownChangeBody(t, faultPassword), http.StatusInternalServerError, "internal server error"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := authServerOn(t, tc.store(t), tc.userID)
			res := send(t, srv, http.MethodPatch, "/auth/me/password", tc.body)
			assert.Equal(t, tc.wantStatus, res.StatusCode)
			assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
			assert.Equal(t, tc.wantDetail, problemDetail(t, res))
		})
	}
}

// Logout and refresh render storage failures as 500.
// The detail stays generic: the SQL error text never reaches the client.
func TestHandler_SessionEndpoints_StorageFailure(t *testing.T) {
	tests := []struct {
		name string
		key  string
		path string
	}{
		{"logout", "auth.refresh_revoke_token", "/auth/logout"},
		{"refresh", "auth.refresh_redeem", "/auth/refresh"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, u := faultAccount(t)
			sess, err := svcOn(tx, testutil.Store(t)).Login(ctx, u.Email, faultPassword)
			require.NoError(t, err)

			r := chi.NewRouter()
			r.Mount("/auth", auth.Routes(auth.NewHandler(svcOn(tx, failing(t, tc.key))),
				func(next http.Handler) http.Handler { return next }))
			srv := httptest.NewServer(r)
			t.Cleanup(srv.Close)

			body, err := json.Marshal(auth.RefreshRequest{RefreshToken: sess.RefreshToken})
			require.NoError(t, err)
			res, err := srv.Client().Post(srv.URL+tc.path, "application/json", bytes.NewReader(body))
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "internal server error", problemDetail(t, res))
		})
	}
}
