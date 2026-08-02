package users

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

var (
	ErrNotFound = errors.New("user not found")
	// Demoting or deactivating the last active superadmin locks everyone out
	// of user management for good: SeedSuperadmin is ON CONFLICT DO NOTHING,
	// so a restart does not restore the account.
	ErrLastSuperadmin = errors.New("cannot demote or deactivate the last active superadmin")
)

// normalizeEmail keeps stored addresses case-folded, matching the
// LOWER(email) lookups and the users_email_lower_idx unique index.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

func (r *Repo) GetByEmail(ctx context.Context, email string) (User, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.get_by_email"), email)
	if err != nil {
		return User{}, err
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

// LockStatus reports login-lockout state for an email.
type LockStatus struct {
	FailedLoginAttempts int        `db:"failed_login_attempts"`
	LockedUntil         *time.Time `db:"locked_until"`
}

// LockStatus reads the account's lockout state.
func (r *Repo) LockStatus(ctx context.Context, email string) (LockStatus, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.lock_status"), email)
	if err != nil {
		return LockStatus{}, err
	}
	s, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[LockStatus])
	if errors.Is(err, pgx.ErrNoRows) {
		return LockStatus{}, ErrNotFound
	}
	return s, err
}

// RecordFailedLogin increments the counter and locks past the threshold.
func (r *Repo) RecordFailedLogin(ctx context.Context, email string) error {
	_, err := r.db.Exec(ctx, r.store.Get("users.record_failed_login"), email)
	return err
}

// ResetLoginAttempts clears the counter after a successful login.
func (r *Repo) ResetLoginAttempts(ctx context.Context, email string) error {
	_, err := r.db.Exec(ctx, r.store.Get("users.reset_login_attempts"), email)
	return err
}

func (r *Repo) GetByID(ctx context.Context, id int64) (User, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.get_by_id"), id)
	if err != nil {
		return User{}, err
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (r *Repo) Create(ctx context.Context, req CreateUserRequest, actorID int64) (User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}

	rows, err := r.db.Query(ctx, r.store.Get("users.create"),
		normalizeEmail(req.Email), req.Name, string(hash), req.Role, req.IsActive, actorID,
	)
	if err != nil {
		return User{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
}

// sortable is the closed set of user sort keys.
var sortable = listq.Whitelist{
	Default: "created_at",
	Columns: map[string]listq.Column{
		"name":       {Expr: "name", Dir: listq.Asc},
		"createdAt":  {Expr: "created_at", Dir: listq.Desc},
		"created_at": {Expr: "created_at", Dir: listq.Desc},
	},
}

// tiebreak keeps paging stable when the sort key ties.
var tiebreak = listq.Column{Expr: "id", Dir: listq.Desc}

func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg("%" + f.Q + "%")
		c.And("(LOWER(name) LIKE LOWER(" + p +
			") OR LOWER(email) LIKE LOWER(" + p + "))")
	}
	if f.Role != nil {
		p := c.Arg(*f.Role)
		c.And("role = " + p)
	}
	if f.IsActive != nil {
		p := c.Arg(*f.IsActive)
		c.And("is_active = " + p)
	}

	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("users.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, err
	}

	dataSQL, dataArgs := c.Data(
		r.store.Get("users.list_base"),
		listq.OrderBy(sortable, f.SortBy, f.SortDir, tiebreak),
		listq.Page(f.Limit, f.Offset),
	)

	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[User])
	if out.Rows == nil {
		out.Rows = []User{}
	}
	return out, err
}

// updatePrecheck is the target's state before an update.
type updatePrecheck struct {
	Role                  Role `db:"role"`
	IsActive              bool `db:"is_active"`
	OtherActiveSuperadmin bool `db:"other_active_superadmin"`
}

func (r *Repo) Update(ctx context.Context, id int64, req UpdateUserRequest, actorID int64) (User, error) {
	email := normalizeEmail(req.Email)

	var count int64
	if err := r.db.QueryRow(ctx, r.store.Get("users.exists_email_other"), email, id).Scan(&count); err != nil {
		return User{}, err
	}
	if count > 0 {
		return User{}, errors.New("email already used")
	}

	prior, err := r.precheck(ctx, id)
	if err != nil {
		return User{}, err
	}
	// Enforced here rather than in a trigger: the one migration this change
	// ships is NO TRANSACTION (CONCURRENTLY), so adding DDL to it risks
	// partial state, and a trigger's SQLSTATE would need a new mapping in
	// shared/httperr to reach the client as RFC 7807. Residual race: two
	// concurrent demotes can both read other_active_superadmin = false and
	// pass. Closing that needs the caller-owned transaction seam (audit #17).
	losingLastSuperadmin := prior.Role == RoleSuperadmin && prior.IsActive &&
		!prior.OtherActiveSuperadmin &&
		(req.Role != RoleSuperadmin || !req.IsActive)
	if losingLastSuperadmin {
		return User{}, ErrLastSuperadmin
	}

	rows, err := r.db.Query(ctx, r.store.Get("users.update"),
		id, req.Name, email, req.Role, req.IsActive, actorID,
	)
	if err != nil {
		return User{}, err
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}

	// A role change or a deactivation must not leave live sessions behind; a
	// plain rename is not security-relevant, so it keeps them.
	if prior.Role != u.Role || (prior.IsActive && !u.IsActive) {
		if err := r.revokeRefreshTokens(ctx, id); err != nil {
			// The update already committed. A 500 here would send the admin
			// into a retry whose precheck sees no change and so revokes
			// nothing; report success and log the sessions left standing.
			slog.ErrorContext(ctx, "revoke refresh tokens after user update",
				"error", err, "user_id", id)
		}
	}
	return u, nil
}

// precheck reads prior state without the is_active filter GetByID applies,
// so reactivating a disabled account still works.
func (r *Repo) precheck(ctx context.Context, id int64) (updatePrecheck, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.update_precheck"), id)
	if err != nil {
		return updatePrecheck{}, err
	}
	p, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[updatePrecheck])
	if errors.Is(err, pgx.ErrNoRows) {
		return updatePrecheck{}, ErrNotFound
	}
	return p, err
}

// revokeRefreshTokens ends every live session for a user after a
// security-relevant credential change; without it a stolen refresh token
// keeps rotating for the full refresh window after a password reset.
// Runs after the write rather than inside it: sharing the caller's
// transaction needs the DI seam from audit #17. The auth query is reached
// through the store because auth already imports users.
func (r *Repo) revokeRefreshTokens(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_revoke_user"), id)
	return err
}

func (r *Repo) UpdatePassword(ctx context.Context, id int64, newPassword string, actorID int64) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	tag, err := r.db.Exec(ctx, r.store.Get("users.update_password"),
		string(hash), actorID, id,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	// Surfaced, not logged: a swallowed failure leaves the attacker's stolen
	// token alive behind a password the admin believes is now safe. The retry
	// is harmless (re-hash, re-revoke).
	return r.revokeRefreshTokens(ctx, id)
}
