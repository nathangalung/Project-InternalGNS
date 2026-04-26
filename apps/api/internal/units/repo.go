package units

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repo encapsulates DB access untuk units domain.
// Pakai pgxpool langsung dengan raw SQL. Bila nanti swap ke
// sqlc-generated, signature method tidak berubah.
type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// ListAll returns all units ordered by id.
// Master data — small (puluhan rows), aman SELECT *.
func (r *Repo) ListAll(ctx context.Context) ([]Unit, error) {
	const q = `SELECT id, code, name, coretax_code FROM units ORDER BY id`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Unit])
}
