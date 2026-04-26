package countries

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// ListAll returns all 251 countries ordered alphabetically by name.
// Cached di FE — call sekali per session.
func (r *Repo) ListAll(ctx context.Context) ([]Country, error) {
	const q = `SELECT code, name, dial_code FROM countries ORDER BY name`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Country])
}
