package users

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

var ErrNotFound = errors.New("user not found")

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
		req.Email, req.Name, string(hash), req.Role, req.IsActive, actorID,
	)
	if err != nil {
		return User{}, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
}

func (r *Repo) List(ctx context.Context, q *string, role *string, limit, offset int) ([]User, error) {
	rows, err := r.db.Query(ctx, r.store.Get("users.list"), q, role, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[User])
}

func (r *Repo) Update(ctx context.Context, id int64, req UpdateUserRequest, actorID int64) (User, error) {
	var count int64
	if err := r.db.QueryRow(ctx, r.store.Get("users.exists_email_other"), req.Email, id).Scan(&count); err != nil {
		return User{}, err
	}
	if count > 0 {
		return User{}, errors.New("email already used")
	}

	rows, err := r.db.Query(ctx, r.store.Get("users.update"),
		id, req.Name, req.Email, req.Role, req.IsActive, actorID,
	)
	if err != nil {
		return User{}, err
	}
	u, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[User])
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
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
	return nil
}
