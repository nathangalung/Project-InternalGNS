package listq

import (
	"strings"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
)

// whitelist mirrors a repo definition for the tests below.
var whitelist = Whitelist{
	Default: "name",
	Columns: map[string]Column{
		"name":       {Expr: "cc.name", Dir: Asc},
		"createdAt":  {Expr: "cc.created_at", Dir: Desc},
		"created_at": {Expr: "cc.created_at", Dir: Desc},
	},
}

var pk = Column{Expr: "cc.id", Dir: Desc}

func TestConditionsPlaceholderNumbering(t *testing.T) {
	c := New()
	if got := c.Arg("%acme%"); got != "$1" {
		t.Fatalf("first placeholder = %q, want $1", got)
	}
	c.And("cc.name ILIKE $1")
	if got := c.Arg(true); got != "$2" {
		t.Fatalf("second placeholder = %q, want $2", got)
	}
	c.And("cc.is_active = $2")

	countSQL, countArgs := c.Count("SELECT COUNT(*) FROM company_client cc WHERE 1=1")
	wantCount := "SELECT COUNT(*) FROM company_client cc WHERE 1=1" +
		" AND cc.name ILIKE $1 AND cc.is_active = $2"
	if countSQL != wantCount {
		t.Errorf("count SQL = %q, want %q", countSQL, wantCount)
	}
	if len(countArgs) != 2 {
		t.Fatalf("count args = %d, want 2", len(countArgs))
	}

	order := OrderBy(whitelist, "", "", pk)
	dataSQL, dataArgs := c.Data("SELECT * FROM company_client cc WHERE 1=1", order, Page(25, 50))
	wantData := "SELECT * FROM company_client cc WHERE 1=1" +
		" AND cc.name ILIKE $1 AND cc.is_active = $2" +
		" ORDER BY cc.name ASC, cc.id DESC LIMIT $3 OFFSET $4"
	if dataSQL != wantData {
		t.Errorf("data SQL = %q, want %q", dataSQL, wantData)
	}
	if len(dataArgs) != 4 {
		t.Fatalf("data args = %d, want 4", len(dataArgs))
	}
	if dataArgs[2] != 25 || dataArgs[3] != 50 {
		t.Errorf("page args = %v/%v, want 25/50", dataArgs[2], dataArgs[3])
	}
}

// Rendering twice must not mutate or alias the shared arg set.
func TestConditionsDualRenderIsStable(t *testing.T) {
	c := New()
	c.And("cc.name ILIKE " + c.Arg("%acme%"))

	firstSQL, firstArgs := c.Count("SELECT COUNT(*) FROM t WHERE 1=1")
	_, dataArgs := c.Data("SELECT * FROM t WHERE 1=1", OrderBy(whitelist, "", "", pk), Page(0, 0))
	secondSQL, secondArgs := c.Count("SELECT COUNT(*) FROM t WHERE 1=1")

	if firstSQL != secondSQL {
		t.Errorf("count SQL drifted: %q then %q", firstSQL, secondSQL)
	}
	if len(firstArgs) != 1 || len(secondArgs) != 1 {
		t.Fatalf("count args = %d then %d, want 1 both", len(firstArgs), len(secondArgs))
	}
	if firstArgs[0] != "%acme%" || secondArgs[0] != "%acme%" {
		t.Errorf("count args mutated: %v then %v", firstArgs, secondArgs)
	}
	if len(dataArgs) != 3 {
		t.Fatalf("data args = %d, want 3", len(dataArgs))
	}
	// Writing through the data slice must not reach the count slice.
	dataArgs[0] = "clobbered"
	if firstArgs[0] != "%acme%" {
		t.Errorf("data render aliases count args: %v", firstArgs)
	}
}

func TestOrderByWhitelist(t *testing.T) {
	tests := []struct {
		name    string
		sortBy  string
		sortDir string
		want    string
	}{
		{"default key", "", "", "cc.name ASC, cc.id DESC"},
		{"known key", "createdAt", "", "cc.created_at DESC, cc.id DESC"},
		{"snake alias", "created_at", "", "cc.created_at DESC, cc.id DESC"},
		{"explicit asc wins", "createdAt", "asc", "cc.created_at ASC, cc.id DESC"},
		{"explicit desc wins", "name", "DESC", "cc.name DESC, cc.id DESC"},
		{"garbage dir keeps column default", "createdAt", "sideways", "cc.created_at DESC, cc.id DESC"},
		{"unknown key falls back", "cc.password_hash", "", "cc.name ASC, cc.id DESC"},
		{"injection key falls back", "1; DROP TABLE users--", "", "cc.name ASC, cc.id DESC"},
		{"injection dir falls back", "name", "ASC; DROP TABLE users--", "cc.name ASC, cc.id DESC"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := OrderBy(whitelist, tt.sortBy, tt.sortDir, pk).Clause()
			if got != tt.want {
				t.Fatalf("clause = %q, want %q", got, tt.want)
			}
		})
	}
}

// No caller-supplied text may reach the rendered clause.
func TestOrderByNeverInterpolatesCallerInput(t *testing.T) {
	poison := []string{
		"cc.name; DROP TABLE company_client",
		"(SELECT password_hash FROM users LIMIT 1)",
		"cc.name/**/UNION/**/SELECT",
		"name",
	}
	for _, p := range poison {
		clause := OrderBy(whitelist, p, p, pk).Clause()
		if strings.Contains(clause, "DROP") || strings.Contains(clause, "UNION") ||
			strings.Contains(clause, "password_hash") || strings.Contains(clause, ";") {
			t.Fatalf("clause %q leaked caller input %q", clause, p)
		}
	}
}

// A tiebreak identical to the primary column must not be repeated.
func TestOrderBySuppressesRedundantTiebreak(t *testing.T) {
	w := Whitelist{
		Default: "id",
		Columns: map[string]Column{
			"id":    {Expr: "inv.id", Dir: Desc},
			"total": {Expr: "inv.total", Dir: Desc},
		},
	}
	tb := Column{Expr: "inv.id", Dir: Desc}
	if got := OrderBy(w, "id", "", tb).Clause(); got != "inv.id DESC" {
		t.Errorf("clause = %q, want %q", got, "inv.id DESC")
	}
	if got := OrderBy(w, "total", "", tb).Clause(); got != "inv.total DESC, inv.id DESC" {
		t.Errorf("clause = %q, want %q", got, "inv.total DESC, inv.id DESC")
	}
	if got := OrderBy(w, "total", "", Column{}).Clause(); got != "inv.total DESC" {
		t.Errorf("empty tiebreak emitted: %q", got)
	}
}

func TestPageClamp(t *testing.T) {
	tests := []struct {
		name              string
		limit, offset     int
		wantLim, wantOffs int
	}{
		{"zero falls back", 0, 0, DefaultLimit, 0},
		{"negative falls back", -5, 10, DefaultLimit, 10},
		{"in range kept", 25, 100, 25, 100},
		{"at max kept", paginate.MaxLimit, 0, paginate.MaxLimit, 0},
		{"over max clamped", paginate.MaxLimit + 1, 0, paginate.MaxLimit, 0},
		{"export limit clamped", 100000, 0, paginate.MaxLimit, 0},
		{"negative offset floored", 10, -3, 10, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Page(tt.limit, tt.offset)
			if got.Limit != tt.wantLim || got.Offset != tt.wantOffs {
				t.Fatalf("Page(%d,%d) = %+v, want {%d %d}",
					tt.limit, tt.offset, got, tt.wantLim, tt.wantOffs)
			}
		})
	}
}

// Empty conditions still render a valid pair.
func TestNoConditions(t *testing.T) {
	c := New()
	countSQL, countArgs := c.Count("SELECT COUNT(*) FROM t WHERE 1=1")
	if countSQL != "SELECT COUNT(*) FROM t WHERE 1=1" || len(countArgs) != 0 {
		t.Fatalf("count = %q / %v", countSQL, countArgs)
	}
	dataSQL, dataArgs := c.Data("SELECT * FROM t WHERE 1=1", OrderBy(whitelist, "", "", pk), Page(10, 0))
	want := "SELECT * FROM t WHERE 1=1 ORDER BY cc.name ASC, cc.id DESC LIMIT $1 OFFSET $2"
	if dataSQL != want {
		t.Fatalf("data = %q, want %q", dataSQL, want)
	}
	if len(dataArgs) != 2 {
		t.Fatalf("data args = %d, want 2", len(dataArgs))
	}
}
