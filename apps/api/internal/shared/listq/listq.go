// Package listq builds filtered list queries.
//
// A list endpoint runs two statements over one filter: a COUNT and a paged
// data SELECT. Conditions owns the argument slice and the placeholder
// numbering so both statements render from a single arg set, and Page owns
// the limit clamp so paginate.MaxLimit is the only definition of it.
//
// Sort keys arrive from the query string. OrderBy maps them through a closed
// whitelist to a fixed column expression; a caller-supplied column name is
// never interpolated into SQL.
package listq

import (
	"strconv"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
)

// Direction is a validated SQL sort direction.
type Direction string

const (
	Asc  Direction = "ASC"
	Desc Direction = "DESC"
)

// Column is one whitelist entry.
//
// Expr is a fixed SQL expression written by the repo, never by the client.
// Dir is the direction used when the request omits sortDir.
type Column struct {
	Expr string
	Dir  Direction
}

// Whitelist is a closed set of sort keys.
//
// Default names the entry used for an empty or unrecognised sort key.
type Whitelist struct {
	Default string
	Columns map[string]Column
}

// Order is a rendered ORDER BY clause.
type Order struct {
	clause string
}

// Clause returns the rendered ORDER BY body.
func (o Order) Clause() string { return o.clause }

// OrderBy resolves a client sort key through the whitelist.
//
// An unknown key falls back to the whitelist default. sortDir overrides the
// column direction only when it is exactly asc or desc; anything else keeps
// the column default. The tiebreak column is appended for stable paging and
// is skipped when it repeats the primary expression.
func OrderBy(w Whitelist, sortBy, sortDir string, tiebreak Column) Order {
	col, ok := w.Columns[sortBy]
	if !ok {
		col = w.Columns[w.Default]
	}
	dir := col.Dir
	switch {
	case strings.EqualFold(sortDir, "asc"):
		dir = Asc
	case strings.EqualFold(sortDir, "desc"):
		dir = Desc
	}
	clause := col.Expr + " " + string(dir)
	if tiebreak.Expr != "" && tiebreak.Expr != col.Expr {
		clause += ", " + tiebreak.Expr + " " + string(tiebreak.Dir)
	}
	return Order{clause: clause}
}

// DefaultLimit applies when a caller passes a non-positive limit.
const DefaultLimit = 50

// Paging is a clamped LIMIT/OFFSET pair.
type Paging struct {
	Limit  int
	Offset int
}

// Page clamps a requested window to (0, paginate.MaxLimit].
func Page(limit, offset int) Paging {
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > paginate.MaxLimit {
		limit = paginate.MaxLimit
	}
	if offset < 0 {
		offset = 0
	}
	return Paging{Limit: limit, Offset: offset}
}

// Conditions accumulates WHERE fragments and their arguments.
//
// The zero value is ready to use.
type Conditions struct {
	where strings.Builder
	args  []any
}

// New returns empty conditions.
func New() *Conditions { return &Conditions{} }

// Arg binds a value and returns its placeholder.
func (c *Conditions) Arg(v any) string {
	c.args = append(c.args, v)
	return "$" + strconv.Itoa(len(c.args))
}

// And appends a conjunctive fragment.
func (c *Conditions) And(fragment string) {
	c.where.WriteString(" AND " + fragment)
}

// Where returns the accumulated fragment.
func (c *Conditions) Where() string { return c.where.String() }

// Count renders the count statement.
func (c *Conditions) Count(base string) (string, []any) {
	return base + c.where.String(), c.cloneArgs()
}

// Data renders the paged statement.
//
// Page placeholders are numbered after the WHERE arguments, so Count and
// Data stay consistent no matter which is rendered first or how often.
func (c *Conditions) Data(base string, order Order, p Paging) (string, []any) {
	args := c.cloneArgs()
	limit := "$" + strconv.Itoa(len(args)+1)
	offset := "$" + strconv.Itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)
	return base + c.where.String() +
		" ORDER BY " + order.clause +
		" LIMIT " + limit + " OFFSET " + offset, args
}

// cloneArgs copies the args so a render never aliases the accumulator.
func (c *Conditions) cloneArgs() []any {
	out := make([]any, len(c.args))
	copy(out, c.args)
	return out
}
