package users

import (
	"context"
	"errors"
	"strconv"
	"strings"

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

func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	args := []any{}
	addArg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := strings.Builder{}
	if f.Q != "" {
		p := addArg("%" + f.Q + "%")
		where.WriteString(" AND (LOWER(name) LIKE LOWER(" + p +
			") OR LOWER(email) LIKE LOWER(" + p + "))")
	}
	if f.Role != nil {
		p := addArg(*f.Role)
		where.WriteString(" AND role = " + p)
	}
	if f.IsActive != nil {
		p := addArg(*f.IsActive)
		where.WriteString(" AND is_active = " + p)
	}

	var out ListResult
	countSQL := r.store.Get("users.list_count_base") + where.String()
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	sortBy := "created_at"
	switch f.SortBy {
	case "name":
		sortBy = "name"
	case "createdAt", "created_at":
		sortBy = "created_at"
	}
	sortDir := "DESC"
	if strings.EqualFold(f.SortDir, "asc") {
		sortDir = "ASC"
	}

	dataArgs := append([]any{}, args...)
	dataAdd := func(v any) string {
		dataArgs = append(dataArgs, v)
		return "$" + strconv.Itoa(len(dataArgs))
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	dataSQL := r.store.Get("users.list_base") +
		where.String() +
		" ORDER BY " + sortBy + " " + sortDir + ", id DESC" +
		" LIMIT " + dataAdd(limit) + " OFFSET " + dataAdd(f.Offset)

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
