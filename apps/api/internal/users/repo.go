package users

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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
	// ErrEmailTaken keeps a duplicate address a 409 with a sentence the user
	// can act on, instead of the untyped error that rendered as a 500.
	ErrEmailTaken = errors.New("email already used")
)

// Messages the handler renders for these sentinels.
const (
	emailTakenMessage     = "Email sudah digunakan pengguna lain."
	lastSuperadminMessage = "Superadmin aktif terakhir tidak dapat diturunkan atau dinonaktifkan."
)

// isUniqueViolation reports a 23505 from the email index.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

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

// AuthContext is the live account state behind an access token.
type AuthContext struct {
	Role              Role      `db:"role"`
	IsActive          bool      `db:"is_active"`
	SessionsValidFrom time.Time `db:"sessions_valid_from"`
}

// AuthContext reads the state the auth middleware checks per request.
func (r *Repo) AuthContext(ctx context.Context, id int64) (AuthContext, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.auth_context"), id)
	if err != nil {
		return AuthContext{}, fmt.Errorf("read auth context: %w", err)
	}
	a, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[AuthContext])
	if errors.Is(err, pgx.ErrNoRows) {
		return AuthContext{}, ErrNotFound
	}
	if err != nil {
		return AuthContext{}, fmt.Errorf("read auth context: %w", err)
	}
	return a, nil
}

// GetByIDAdmin reads any account, active or not, for the admin detail page.
func (r *Repo) GetByIDAdmin(ctx context.Context, id int64) (User, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.get_by_id_admin"), id)
	if err != nil {
		return User{}, fmt.Errorf("read user: %w", err)
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("read user: %w", err)
	}
	return u, nil
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
		normalizeEmail(req.Email), strings.TrimSpace(req.Name), string(hash), req.Role, req.IsActive, actorID,
	)
	if err != nil {
		return User{}, err
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	// The unique index is the only thing that sees a concurrent insert, so
	// the sentinel has to be recognised here too and not only on update.
	if isUniqueViolation(err) {
		return User{}, ErrEmailTaken
	}
	if err != nil {
		return User{}, fmt.Errorf("create user: %w", err)
	}
	return u, nil
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

// ErrNoTx marks an executor that cannot open a transaction, so the guard
// could not be serialised.
var ErrNoTx = errors.New("users: executor cannot begin a transaction")

// inTx runs fn on a repo bound to one transaction. Under a pool that is a
// real transaction; under a caller's pgx.Tx it is a savepoint, so a failure
// here leaves the caller's transaction usable.
func (r *Repo) inTx(ctx context.Context, fn func(q *Repo) error) error {
	b, ok := r.db.(db.TxBeginner)
	if !ok {
		return ErrNoTx
	}
	tx, err := b.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin user tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := fn(&Repo{db: tx, store: r.store}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit user tx: %w", err)
	}
	return nil
}

// Update runs the email check, the last-superadmin guard, the write and the
// session revocation as one unit behind the guard lock. Stays READ
// COMMITTED on purpose: each statement after the lock sees the state the
// previous holder committed, which a REPEATABLE READ snapshot would not.
func (r *Repo) Update(ctx context.Context, id int64, req UpdateUserRequest, actorID int64) (User, error) {
	var out User
	err := r.inTx(ctx, func(q *Repo) error {
		u, err := q.update(ctx, id, req, actorID)
		out = u
		return err
	})
	return out, err
}

func (r *Repo) update(ctx context.Context, id int64, req UpdateUserRequest, actorID int64) (User, error) {
	if _, err := r.db.Exec(ctx, r.store.Get("users.superadmin_guard_lock")); err != nil {
		return User{}, fmt.Errorf("take superadmin guard: %w", err)
	}

	email := normalizeEmail(req.Email)
	var count int64
	if err := r.db.QueryRow(ctx, r.store.Get("users.exists_email_other"), email, id).Scan(&count); err != nil {
		return User{}, fmt.Errorf("check email: %w", err)
	}
	if count > 0 {
		return User{}, ErrEmailTaken
	}

	prior, err := r.precheck(ctx, id)
	if err != nil {
		return User{}, err
	}
	losingLastSuperadmin := prior.Role == RoleSuperadmin && prior.IsActive &&
		!prior.OtherActiveSuperadmin &&
		(req.Role != RoleSuperadmin || !req.IsActive)
	if losingLastSuperadmin {
		return User{}, ErrLastSuperadmin
	}

	rows, err := r.db.Query(ctx, r.store.Get("users.update"),
		id, strings.TrimSpace(req.Name), email, req.Role, req.IsActive, actorID,
	)
	if err != nil {
		return User{}, fmt.Errorf("update user: %w", err)
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	// The email check cannot see a concurrent insert; the index can.
	if isUniqueViolation(err) {
		return User{}, ErrEmailTaken
	}
	if err != nil {
		return User{}, fmt.Errorf("update user: %w", err)
	}

	// A role change or a deactivation must not leave live sessions behind; a
	// plain rename is not security-relevant, so it keeps them. Inside the
	// transaction, so a failed revoke undoes the change and a retry redoes
	// both.
	if prior.Role != u.Role || (prior.IsActive && !u.IsActive) {
		if err := r.revokeRefreshTokens(ctx, id); err != nil {
			return User{}, err
		}
	}
	return u, nil
}

// precheck reads prior state without the is_active filter GetByID applies,
// so reactivating a disabled account still works.
func (r *Repo) precheck(ctx context.Context, id int64) (updatePrecheck, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.update_precheck"), id)
	if err != nil {
		return updatePrecheck{}, fmt.Errorf("read user precheck: %w", err)
	}
	p, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[updatePrecheck])
	if errors.Is(err, pgx.ErrNoRows) {
		return updatePrecheck{}, ErrNotFound
	}
	if err != nil {
		return updatePrecheck{}, fmt.Errorf("read user precheck: %w", err)
	}
	return p, nil
}

// revokeRefreshTokens ends every live session for a user after a
// security-relevant credential change. The auth query is reached through
// the store because auth already imports users.
func (r *Repo) revokeRefreshTokens(ctx context.Context, id int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_revoke_user"), id, "admin")
	if err != nil {
		return fmt.Errorf("revoke refresh tokens: %w", err)
	}
	return nil
}

// UpdatePassword swaps the hash and ends every session in one transaction:
// a reset that kept a stolen refresh token alive would be worse than none.
func (r *Repo) UpdatePassword(ctx context.Context, id int64, newPassword string, actorID int64) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return r.inTx(ctx, func(q *Repo) error {
		tag, err := q.db.Exec(ctx, q.store.Get("users.update_password"), string(hash), actorID, id)
		if err != nil {
			return fmt.Errorf("update password: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return q.revokeRefreshTokens(ctx, id)
	})
}
