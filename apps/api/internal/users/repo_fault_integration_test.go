package users_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Two failure shapes per statement.
// A prepare-time error (42703) comes back from Query itself; an
// execution-time error (22012) only when the rows are read.
const (
	prepareFault = "42703"
	execFault    = "22012"
)

// Failing stand-ins, typed like the statements they replace.
var faultSQL = map[string]map[string]string{
	prepareFault: {
		"users.get_by_id_admin": `SELECT no_such_column FROM users WHERE id = $1`,
		"users.auth_context":    `SELECT no_such_column FROM users WHERE id = $1`,
		"users.lock_status":     `SELECT no_such_column FROM users WHERE email = $1`,
		"users.update_precheck": `SELECT no_such_column FROM users WHERE id = $1`,
		"users.update": `SELECT no_such_column FROM users WHERE id = $1 AND name = $2 AND email = $3
			AND role = $4 AND is_active = $5 AND updated_by = $6`,
	},
	execFault: {
		"users.get_by_id_admin":      `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL`,
		"users.auth_context":         `SELECT (1 / 0)::text AS role, TRUE AS is_active, now() AS sessions_valid_from WHERE $1::bigint IS NOT NULL`,
		"users.reset_login_attempts": `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL AND $2::text IS NOT NULL`,
		"users.create": `SELECT 1 / 0 WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL AND $3::text IS NOT NULL
			AND $4::text IS NOT NULL AND $5::boolean IS NULL AND $6::bigint IS NOT NULL`,
		"users.list_count_base":    `SELECT COUNT(*) / 0 FROM users WHERE 1=1`,
		"users.list_base":          `SELECT id, email, name, password_hash, role, is_active, created_at, updated_at FROM users WHERE 1 / 0 = 1`,
		"users.exists_email_other": `SELECT COUNT(*) / 0 FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2`,
		"users.update_precheck":    `SELECT 'x' AS role, TRUE AS is_active, 1 / 0 = 1 AS other_active_superadmin WHERE $1::bigint IS NOT NULL`,
		"users.update": `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL AND $2::text IS NOT NULL AND $3::text IS NOT NULL
			AND $4::text IS NOT NULL AND $5::boolean IS NOT NULL AND $6::bigint IS NOT NULL`,
		"users.update_password": `SELECT 1 / 0 WHERE $1::text IS NOT NULL AND $2::bigint IS NOT NULL AND $3::bigint IS NOT NULL`,
	},
}

// storeWith copies the real store with overrides.
func storeWith(t *testing.T, overrides map[string]string) queries.Store {
	t.Helper()
	store := queries.Store{}
	for k, v := range testutil.Store(t) {
		store[k] = v
	}
	for k, v := range overrides {
		store[k] = v
	}
	return store
}

// faulty overrides key with the stand-in for code.
func faulty(t *testing.T, code, key string) queries.Store {
	t.Helper()
	sql, ok := faultSQL[code][key]
	require.True(t, ok, "no %s stand-in for %s", code, key)
	return storeWith(t, map[string]string{key: sql})
}

// faultTarget creates an operational account in a test transaction.
func faultTarget(t *testing.T) (context.Context, pgx.Tx, users.User) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	u, err := users.NewRepo(tx, testutil.Store(t)).Create(ctx, users.CreateUserRequest{
		Email: fmt.Sprintf("fault-%d@test.local", randSuffix()), Name: "Fault",
		Password: validPassword, Role: users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)
	return ctx, tx, u
}

// Repo storage failures surface wrapped.
// The wrap names the step, and a failure inside Update or UpdatePassword
// rolls the whole unit back.
func TestRepo_StorageFailuresSurface(t *testing.T) {
	promote := func(u users.User) users.UpdateUserRequest {
		return users.UpdateUserRequest{Email: u.Email, Name: "Renamed", Role: users.RoleFinance, IsActive: true}
	}
	tests := []struct {
		code   string
		key    string
		prefix string
		call   func(ctx context.Context, r *users.Repo, u users.User) error
		// inTx marks calls that run in their own savepoint, so the test
		// transaction survives and the rollback can be checked.
		inTx bool
	}{
		{prepareFault, "users.get_by_id_admin", "read user", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.GetByIDAdmin(ctx, u.ID)
			return err
		}, false},
		{execFault, "users.get_by_id_admin", "read user", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.GetByIDAdmin(ctx, u.ID)
			return err
		}, false},
		{prepareFault, "users.auth_context", "read auth context", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.AuthContext(ctx, u.ID)
			return err
		}, false},
		{execFault, "users.auth_context", "read auth context", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.AuthContext(ctx, u.ID)
			return err
		}, false},
		{prepareFault, "users.lock_status", "", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.LockStatus(ctx, u.Email)
			return err
		}, false},
		{execFault, "users.reset_login_attempts", "claim login", func(ctx context.Context, r *users.Repo, u users.User) error {
			return r.ClaimLogin(ctx, u.ID, u.PasswordHash)
		}, false},
		{execFault, "users.create", "create user", func(ctx context.Context, r *users.Repo, _ users.User) error {
			_, err := r.Create(ctx, users.CreateUserRequest{
				Email: fmt.Sprintf("fault-new-%d@test.local", randSuffix()), Name: "New",
				Password: validPassword, Role: users.RoleOperational,
			}, seedUserID)
			return err
		}, false},
		{execFault, "users.exists_email_other", "check email", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.Update(ctx, u.ID, promote(u), seedUserID)
			return err
		}, true},
		{prepareFault, "users.update_precheck", "read user precheck", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.Update(ctx, u.ID, promote(u), seedUserID)
			return err
		}, true},
		{execFault, "users.update_precheck", "read user precheck", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.Update(ctx, u.ID, promote(u), seedUserID)
			return err
		}, true},
		{prepareFault, "users.update", "update user", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.Update(ctx, u.ID, promote(u), seedUserID)
			return err
		}, true},
		{execFault, "users.update", "update user", func(ctx context.Context, r *users.Repo, u users.User) error {
			_, err := r.Update(ctx, u.ID, promote(u), seedUserID)
			return err
		}, true},
		{execFault, "users.update_password", "update password", func(ctx context.Context, r *users.Repo, u users.User) error {
			return r.UpdatePassword(ctx, u.ID, "Berbeda2@", seedUserID)
		}, true},
	}
	for _, tc := range tests {
		t.Run(tc.code+" "+tc.key, func(t *testing.T) {
			ctx, tx, u := faultTarget(t)
			err := tc.call(ctx, users.NewRepo(tx, faulty(t, tc.code, tc.key)), u)

			var pgErr *pgconn.PgError
			require.ErrorAs(t, err, &pgErr)
			assert.Equal(t, tc.code, pgErr.Code)
			if tc.prefix != "" {
				assert.True(t, strings.HasPrefix(err.Error(), tc.prefix+": "), "err=%v", err)
			}
			if !tc.inTx {
				return
			}
			got, err := users.NewRepo(tx, testutil.Store(t)).GetByIDAdmin(ctx, u.ID)
			require.NoError(t, err)
			assert.Equal(t, u.Name, got.Name, "the failed unit must roll back")
			assert.Equal(t, u.Role, got.Role, "the failed unit must roll back")
			assert.Equal(t, u.PasswordHash, got.PasswordHash, "the failed unit must roll back")
		})
	}
}

// A failed list read still returns an empty slice.
func TestRepo_List_StorageFailures(t *testing.T) {
	for _, key := range []string{"users.list_count_base", "users.list_base"} {
		t.Run(key, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			res, err := users.NewRepo(tx, faulty(t, execFault, key)).List(ctx, users.ListFilter{Limit: 10})
			var pgErr *pgconn.PgError
			require.ErrorAs(t, err, &pgErr)
			assert.Equal(t, execFault, pgErr.Code)
			if key == "users.list_base" {
				assert.NotNil(t, res.Rows)
				assert.Empty(t, res.Rows)
			}
		})
	}
}

// A lost page read surfaces.
// The count succeeds and the page read itself fails.
func TestRepo_List_PageReadFailureSurfaces(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)

	_, err := users.NewRepo(&testutil.CountingExec{Inner: tx, FailAfter: 1}, store).
		List(ctx, users.ListFilter{Limit: 10})
	assert.ErrorIs(t, err, testutil.ErrFake)
}

// beginFails is an executor whose Begin fails.
type beginFails struct {
	testutil.FakeExec
	testutil.FakeBeginner
}

// A guard that cannot open its transaction does not write.
func TestRepo_Update_BeginFailureSurfaces(t *testing.T) {
	repo := users.NewRepo(beginFails{}, testutil.Store(t))
	_, err := repo.Update(context.Background(), 1, users.UpdateUserRequest{
		Email: "a@test.local", Name: "A", Role: users.RoleFinance, IsActive: true,
	}, seedUserID)
	assert.ErrorIs(t, err, testutil.ErrFake)
	assert.ErrorContains(t, err, "begin user tx")
}

// A deactivated account has no lock row.
// Login treats that as the neutral verdict, so the repo must say not found.
func TestRepo_LockStatus_InactiveAccountIsNotFound(t *testing.T) {
	ctx, tx, u := faultTarget(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	st, err := repo.LockStatus(ctx, strings.ToUpper(u.Email))
	require.NoError(t, err, "the lookup is case-insensitive")
	assert.Zero(t, st.FailedLoginAttempts)

	_, err = tx.Exec(ctx, `UPDATE users SET is_active = FALSE WHERE id = $1`, u.ID)
	require.NoError(t, err)
	_, err = repo.LockStatus(ctx, u.Email)
	assert.ErrorIs(t, err, users.ErrNotFound)
}

// usersServerOn mounts the users routes on tx and store.
func usersServerOn(t *testing.T, tx pgx.Tx, store queries.Store) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserID(req.Context(), seedUserID)))
		})
	})
	r.Mount("/users", users.Routes(deps.Deps{Pool: tx, Queries: store}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// Races the index and the guard catch.
// The email pre-check cannot see a concurrent insert, and the row can go
// between the precheck and the write; both keep their typed answers.
func TestHandler_Update_RacesKeepTheirAnswers(t *testing.T) {
	tests := []struct {
		name       string
		overrides  map[string]string
		takeEmail  bool
		wantStatus int
		wantDetail string
	}{
		{"email taken after the pre-check", map[string]string{
			"users.exists_email_other": `SELECT 0::bigint WHERE $1::text IS NOT NULL AND $2::bigint IS NOT NULL`,
		}, true, http.StatusConflict, "Email sudah digunakan pengguna lain."},
		{"row gone before the write", map[string]string{
			"users.update": `UPDATE users SET name = $2, email = $3, role = $4, is_active = $5, updated_by = $6
				WHERE id = $1 AND FALSE
				RETURNING id, email, name, password_hash, role, is_active, created_at, updated_at`,
		}, false, http.StatusNotFound, "user not found"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, u := faultTarget(t)
			email := u.Email
			if tc.takeEmail {
				other, err := users.NewRepo(tx, testutil.Store(t)).Create(ctx, users.CreateUserRequest{
					Email: fmt.Sprintf("fault-other-%d@test.local", randSuffix()), Name: "Other",
					Password: validPassword, Role: users.RoleOperational,
				}, seedUserID)
				require.NoError(t, err)
				email = strings.ToUpper(other.Email)
			}
			srv := usersServerOn(t, tx, storeWith(t, tc.overrides))
			res := doJSON(t, srv, http.MethodPut, fmt.Sprintf("/users/%d", u.ID), users.UpdateUserRequest{
				Email: email, Name: "Renamed", Role: users.RoleOperational, IsActive: true,
			})
			defer res.Body.Close()
			assert.Equal(t, tc.wantStatus, res.StatusCode)
			assert.Equal(t, tc.wantDetail, problemDetail(t, res))
		})
	}
}

// Handler storage failures are opaque 500s.
func TestHandler_StorageFailuresAre500(t *testing.T) {
	tests := []struct {
		name   string
		key    string
		method string
		path   func(u users.User) string
		body   func(u users.User) any
	}{
		{"list count", "users.list_count_base", http.MethodGet,
			func(users.User) string { return "/users/?isActive=true" }, nil},
		{"list rows", "users.list_base", http.MethodGet,
			func(users.User) string { return "/users/" }, nil},
		{"get", "users.get_by_id_admin", http.MethodGet,
			func(u users.User) string { return fmt.Sprintf("/users/%d", u.ID) }, nil},
		{"create", "users.create", http.MethodPost,
			func(users.User) string { return "/users/" },
			func(users.User) any {
				return map[string]any{
					"email": fmt.Sprintf("fault-new-%d@test.local", randSuffix()), "name": "New",
					"password": validPassword, "role": "operational",
				}
			}},
		{"update", "users.update", http.MethodPut,
			func(u users.User) string { return fmt.Sprintf("/users/%d", u.ID) },
			func(u users.User) any {
				return users.UpdateUserRequest{Email: u.Email, Name: "Renamed", Role: u.Role, IsActive: true}
			}},
		{"password reset", "users.update_password", http.MethodPatch,
			func(u users.User) string { return fmt.Sprintf("/users/%d/password", u.ID) },
			func(users.User) any { return users.ChangePasswordRequest{Password: "Berbeda2@"} }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx, u := faultTarget(t)
			srv := usersServerOn(t, tx, faulty(t, execFault, tc.key))
			var body any
			if tc.body != nil {
				body = tc.body(u)
			}
			res := doJSON(t, srv, tc.method, tc.path(u), body)
			defer res.Body.Close()
			assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
			assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
			assert.Equal(t, "internal server error", problemDetail(t, res))
		})
	}
}

// problemDetail decodes the problem detail.
func problemDetail(t *testing.T, res *http.Response) string {
	t.Helper()
	var p struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	return p.Detail
}
