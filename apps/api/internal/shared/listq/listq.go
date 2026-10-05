// Package listq builds list queries.
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
	"slices"
	"strconv"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
)

// Direction validates SQL sort direction.
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

// Whitelist lists allowed sort keys.
//
// Default names the entry used for an empty or unrecognised sort key.
type Whitelist struct {
	Default string
	Columns map[string]Column
}

// Order renders ORDER BY.
type Order struct {
	clause string
}

// Clause returns the rendered body.
func (o Order) Clause() string { return o.clause }

// OrderBy resolves whitelisted sort keys.
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

// DefaultLimit replaces non-positive limits.
const DefaultLimit = 50

// Paging is clamped LIMIT/OFFSET.
type Paging struct {
	Limit  int
	Offset int
}

// Unbounded opts out of pagination.
// A caller sets it as the Limit.
// Exports use it; it survives Page unclamped, unlike a large sentinel value.
const Unbounded = -1

// Page clamps a requested window.
// The limit ends up in (0, paginate.MaxLimit].
func Page(limit, offset int) Paging {
	if limit == Unbounded {
		return All()
	}
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

// All returns an unclamped window.
// Exports use it, since they must contain every matching row. Explicit rather
// than a large Limit sentinel: overloading the limit is what let the repo
// clamp silently truncate exports to 200 rows.
func All() Paging {
	return Paging{Limit: 0, Offset: 0}
}

// Conditions accumulates WHERE fragments.
// It also keeps their arguments.
//
// The zero value is ready to use.
type Conditions struct {
	where strings.Builder
	args  []any
}

// New returns empty conditions.
func New() *Conditions { return &Conditions{} }

// Arg binds a placeholder value.
// It returns the placeholder.
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
	// Limit 0 is the unbounded export window (see All): emit no LIMIT clause so
	// the caller receives every matching row.
	if p.Limit <= 0 {
		return base + c.where.String() + " ORDER BY " + order.clause, args
	}
	limit := "$" + strconv.Itoa(len(args)+1)
	offset := "$" + strconv.Itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)
	return base + c.where.String() +
		" ORDER BY " + order.clause +
		" LIMIT " + limit + " OFFSET " + offset, args
}

// cloneArgs copies the args.
// A render then never aliases the accumulator.
func (c *Conditions) cloneArgs() []any {
	out := make([]any, len(c.args))
	copy(out, c.args)
	return out
}

// likeEscaper neutralises LIKE metacharacters.
// The backslash goes first: it is the default LIKE escape character, so an
// unescaped one in user input would consume the character after it.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// Contains builds literal ILIKE patterns.
// Search text matches as typed, so a % or _ is not a wildcard.
func Contains(s string) string {
	return "%" + likeEscaper.Replace(s) + "%"
}

// DocNoOrder sorts numbers by year.
//
// Quotation, invoice and delivery-note numbers restart every year, so the
// text alone would list Q-00001/GNS/I/2025 beside Q-00001/GNS/I/2026. The
// key puts the year the number prints, before any revision suffix, in
// front of the number; a number without one sorts on its own text. col is
// a fixed column written by the repo, never by the client.
func DocNoOrder(col string) string {
	return `COALESCE(substring(` + col + ` FROM '/([0-9]{4})(?: Rev\.[0-9]+)?$'), '') || ` + col
}

// romanMonths are the number months.
var romanMonths = []string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}

// Period builds a month-year pattern.
//
// Document numbers end in /GNS/{Roman month}/{year}, optionally followed by
// a revision suffix. A query naming a month and a four-digit year, as
// 10/2026, 1/2026, X/2026 or x / 2026, becomes the ILIKE pattern
// %/X/2026% every number of that period contains. The leading slash anchors
// the month, so I/2026 never matches II/2026, VII/2026 or XI/2026. ok is
// false for anything else, month 0 and 13 included.
func Period(q string) (pattern string, ok bool) {
	month, year, found := strings.Cut(q, "/")
	if !found {
		return "", false
	}
	month = strings.ToUpper(strings.TrimSpace(month))
	year = strings.TrimSpace(year)
	if len(year) != 4 || !digits(year) {
		return "", false
	}
	if digits(month) && len(month) <= 2 {
		n, _ := strconv.Atoi(month)
		if n < 1 || n > 12 {
			return "", false
		}
		month = romanMonths[n-1]
	} else if !slices.Contains(romanMonths, month) {
		return "", false
	}
	return "%/" + month + "/" + year + "%", true
}

// digits reports ASCII digits.
func digits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
