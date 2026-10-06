package cashentries

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

var (
	ErrNotFound        = errors.New("cash entry not found")
	ErrVersionMismatch = errors.New("cash entry version mismatch")
)

type Repo struct {
	db    db.Executor
	store queries.Store
}

func NewRepo(exec db.Executor, store queries.Store) *Repo {
	return &Repo{db: exec, store: store}
}

// order lists the newest day first.
var order = listq.OrderBy(listq.Whitelist{
	Default: "entry_date",
	Columns: map[string]listq.Column{"entry_date": {Expr: "c.entry_date", Dir: listq.Desc}},
}, "", "", listq.Column{Expr: "c.id", Dir: listq.Desc})

// conditions renders a filter.
func conditions(f ListFilter) *listq.Conditions {
	c := listq.New()
	if f.Q != "" {
		p := c.Arg(listq.Contains(f.Q))
		c.And("(c.description ILIKE " + p + " OR c.category ILIKE " + p + ")")
	}
	if f.Direction != "" {
		c.And("c.direction = " + c.Arg(string(f.Direction)))
	}
	if f.Category != "" {
		c.And("c.category = " + c.Arg(f.Category))
	}
	if f.DateFrom != nil {
		c.And("c.entry_date >= " + c.Arg(*f.DateFrom) + "::date")
	}
	if f.DateTo != nil {
		c.And("c.entry_date <= " + c.Arg(*f.DateTo) + "::date")
	}
	return c
}

// List pages entries with total.
func (r *Repo) List(ctx context.Context, f ListFilter) (ListResult, error) {
	c := conditions(f)
	var out ListResult
	countSQL, countArgs := c.Count(r.store.Get("cash_entries.list_count_base"))
	if err := r.db.QueryRow(ctx, countSQL, countArgs...).Scan(&out.Total); err != nil {
		return out, fmt.Errorf("count cash entries: %w", err)
	}
	dataSQL, dataArgs := c.Data(r.store.Get("cash_entries.list_base"), order, listq.Page(f.Limit, f.Offset))
	rows, err := r.db.Query(ctx, dataSQL, dataArgs...)
	if err != nil {
		return out, fmt.Errorf("list cash entries: %w", err)
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByName[Entry])
	return out, err
}

// Summary totals a filter.
// Paging is ignored: the totals cover every matching entry.
func (r *Repo) Summary(ctx context.Context, f ListFilter) (Summary, error) {
	sql, args := conditions(f).Count(r.store.Get("cash_entries.summary_base"))
	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return Summary{}, fmt.Errorf("sum cash entries: %w", err)
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[Summary])
}

// Get reads one entry.
func (r *Repo) Get(ctx context.Context, id int64) (Entry, error) {
	rows, err := r.db.Query(ctx, r.store.Get("cash_entries.get"), id)
	if err != nil {
		return Entry{}, fmt.Errorf("get cash entry: %w", err)
	}
	e, err := pgx.CollectOneRow(rows, pgx.RowToStructByName[Entry])
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	return e, err
}

// Create stores a new entry.
func (r *Repo) Create(ctx context.Context, in EntryInput, userID int64) (int64, error) {
	var id int64
	err := r.db.QueryRow(ctx, r.store.Get("cash_entries.create"),
		in.EntryDate, string(in.Direction), in.Category, in.Amount, in.Description, userID,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("create cash entry: %w", err)
	}
	return id, nil
}

// Update replaces the version read.
func (r *Repo) Update(ctx context.Context, id int64, in EntryInput, userID int64, version int32) error {
	var got int64
	err := r.db.QueryRow(ctx, r.store.Get("cash_entries.update"),
		id, in.EntryDate, string(in.Direction), in.Category, in.Amount, in.Description, userID, version,
	).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return r.missingOrStale(ctx, id)
	}
	if err != nil {
		return fmt.Errorf("update cash entry: %w", err)
	}
	return nil
}

// missingOrStale explains an empty update.
func (r *Repo) missingOrStale(ctx context.Context, id int64) error {
	var exists bool
	if err := r.db.QueryRow(ctx, r.store.Get("cash_entries.exists"), id).Scan(&exists); err != nil {
		return fmt.Errorf("check cash entry: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return ErrVersionMismatch
}

// Delete removes one entry.
func (r *Repo) Delete(ctx context.Context, id int64) error {
	tag, err := r.db.Exec(ctx, r.store.Get("cash_entries.delete"), id)
	if err != nil {
		return fmt.Errorf("delete cash entry: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Categories lists those in use.
func (r *Repo) Categories(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, r.store.Get("cash_entries.categories"))
	if err != nil {
		return nil, fmt.Errorf("list cash categories: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
