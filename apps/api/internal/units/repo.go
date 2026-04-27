package units

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// Units DB access.
type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// ListAll returns every unit row.
func (r *Repo) ListAll(ctx context.Context) ([]Unit, error) {
	rows, err := r.db.Query(ctx, r.store.Get("units.list_all"))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Unit])
}
