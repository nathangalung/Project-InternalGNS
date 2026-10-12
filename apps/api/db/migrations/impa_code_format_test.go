package migrations_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const impaMigration = "00113_impa_code_format.sql"

// splitCase is one fn_impa_split row.
type splitCase struct {
	Note     string  `json:"note"`
	Name     *string `json:"name"`
	Code     *string `json:"code"`
	Move     bool    `json:"move"`
	WantName *string `json:"want_name"`
	WantCode *string `json:"want_code"`
}

// fn_impa_split follows the shared table.
// The import tool's tests run the same file through its own copy.
func TestFnImpaSplit_Table(t *testing.T) {
	raw, err := os.ReadFile("testdata/impa_split.json")
	require.NoError(t, err)
	var tb struct {
		Cases []splitCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(raw, &tb))
	require.NotEmpty(t, tb.Cases)

	ctx, tx := testutil.BeginTx(t)
	for _, c := range tb.Cases {
		t.Run(c.Note, func(t *testing.T) {
			var name, code *string
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT name, code FROM fn_impa_split($1, $2, $3)`, c.Name, c.Code, c.Move).Scan(&name, &code))
			assert.Equal(t, c.WantName, name)
			assert.Equal(t, c.WantCode, code)
		})
	}
}

// validate.IMPAInText moves what SQL moves.
// The API moves a product's marked code before it saves, so every row the
// database would move from a text with no code must give the same code.
func TestIMPAInText_MatchesSplit(t *testing.T) {
	raw, err := os.ReadFile("testdata/impa_split.json")
	require.NoError(t, err)
	var tb struct {
		Cases []splitCase `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(raw, &tb))
	n := 0
	for _, c := range tb.Cases {
		if c.Name == nil || !c.Move {
			continue
		}
		if code, msg := validate.IMPA(deref(c.Code)); msg != "" || code != "" {
			continue
		}
		n++
		t.Run(c.Note, func(t *testing.T) {
			assert.Equal(t, deref(c.WantCode), validate.IMPAInText(*c.Name))
		})
	}
	require.Positive(t, n)
}

// deref reads an optional text.
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// fn_impa_code matches validate.IMPA.
// A valid input stores its six digits or nothing; a bad one comes back as
// typed, so the column check refuses it.
func TestFnImpaCode_MatchesValidate(t *testing.T) {
	raw, err := os.ReadFile("../../internal/shared/validate/testdata/impa_rules.json")
	require.NoError(t, err)
	var tb struct {
		Cases []struct {
			Input string `json:"input"`
			Code  string `json:"code"`
			Valid bool   `json:"valid"`
		} `json:"cases"`
	}
	require.NoError(t, json.Unmarshal(raw, &tb))

	ctx, tx := testutil.BeginTx(t)
	for _, c := range tb.Cases {
		t.Run(c.Input, func(t *testing.T) {
			var got *string
			require.NoError(t, tx.QueryRow(ctx, `SELECT fn_impa_code($1)`, c.Input).Scan(&got))
			switch {
			case !c.Valid:
				require.NotNil(t, got)
				assert.Equal(t, strings.TrimSpace(c.Input), *got)
			case c.Code == "":
				assert.Nil(t, got)
			default:
				require.NotNil(t, got)
				assert.Equal(t, c.Code, *got)
			}
		})
	}
}

// legacyRows holds pre-00113 rows.
type legacyRows struct {
	item, moved, blocked, holder, junk int64
	quotation                          int64
	request                            int64
}

// seedLegacy writes pre-00113 rows.
func seedLegacy(ctx context.Context, t *testing.T, tx pgx.Tx, tag string, withJunk bool) legacyRows {
	t.Helper()
	var r legacyRows
	insert := func(name string, code *string) int64 {
		var id int64
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by)
			VALUES ($1, $2, 19, 1, 1) RETURNING id`, name, code).Scan(&id))
		return id
	}
	code := func(n int) *string {
		s := fmt.Sprintf("9%05d", n)
		return &s
	}
	base, err := strconv.Atoi(tag[len(tag)-4:])
	require.NoError(t, err)
	base *= 10
	r.item = insert("PALU GODAM "+tag+" (IMPA "+*code(base)+")", code(base))
	r.moved = insert("SARUNG TANGAN "+tag+" IMPA "+*code(base + 1), nil)
	r.holder = insert("PEMEGANG "+tag, code(base+2))
	r.blocked = insert("KUNCI "+tag+" - IMPA "+*code(base + 2), nil)
	if withJunk {
		junk := "J" + tag
		r.junk = insert("BARANG LAMA "+tag, &junk)
	}

	repo := quotations.NewRepo(tx, testutil.Store(t))
	reqCode := *code(base + 3)
	id, err := repo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{{
			RequestedName: "Kunci Ring " + tag + " (IMPA " + reqCode + ")", RequestedImpa: &reqCode,
			OfferedItemID: &r.item, Qty: "1", UnitID: 19, SellingPrice: "1000",
		}}),
	}, 1)
	require.NoError(t, err)
	r.quotation = id
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotation_item_requests (quotation_id, line_no, request_text, created_by)
		VALUES ($1, 1, $2, 1) RETURNING id`, id, "Tali "+tag+" IMPA "+*code(base + 4)).Scan(&r.request))
	return r
}

// Up cleans stored rows.
// Down, then legacy rows, then Up: a name loses its own code, a marked
// code moves into an empty code field unless another active product holds
// it, line versions stay and the learning cache learns nothing.
func TestMigration00113_CleansStoredRows(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := tx.Exec(ctx, downSQL(t, impaMigration))
	require.NoError(t, err)

	tag := strconv.FormatInt(time.Now().UnixNano()%1_000_000, 10)
	tag = fmt.Sprintf("%06s", tag)
	r := seedLegacy(ctx, t, tx, tag, false)

	// The request is filed: a sent quotation keeps its offer.
	_, err = tx.Exec(ctx, `UPDATE quotations SET status = 'sent' WHERE id = $1`, r.quotation)
	require.NoError(t, err)
	var version int32
	var learned int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT row_version FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product'`, r.quotation).Scan(&version))
	require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM item_request_matches`).Scan(&learned))

	_, err = tx.Exec(ctx, upSQL(t, impaMigration))
	require.NoError(t, err)

	item := func(id int64) (string, *string) {
		var name string
		var code *string
		require.NoError(t, tx.QueryRow(ctx, `SELECT name, impa_code FROM items WHERE id = $1`, id).Scan(&name, &code))
		return name, code
	}
	name, code := item(r.item)
	assert.Equal(t, "PALU GODAM "+tag, name)
	require.NotNil(t, code)

	name, code = item(r.moved)
	assert.Equal(t, "SARUNG TANGAN "+tag, name, "a marked code leaves the name")
	require.NotNil(t, code, "and moves into the empty code field")

	name, code = item(r.blocked)
	assert.Contains(t, name, "IMPA", "a code another product holds stays in the name")
	assert.Nil(t, code)

	var reqName string
	var reqCode *string
	var after int32
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT requested_name, requested_impa, row_version FROM quotation_items
		WHERE quotation_id = $1 AND item_type = 'product'`, r.quotation).Scan(&reqName, &reqCode, &after))
	assert.Equal(t, "Kunci Ring "+tag, reqName)
	assert.Equal(t, version, after, "the backfill keeps the line version")

	var text string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT request_text, request_impa FROM quotation_item_requests WHERE id = $1`, r.request).Scan(&text, &reqCode))
	assert.Equal(t, "Tali "+tag, text)
	require.NotNil(t, reqCode)

	var now int64
	require.NoError(t, tx.QueryRow(ctx, `SELECT count(*) FROM item_request_matches`).Scan(&now))
	assert.Equal(t, learned, now, "the backfill teaches the cache nothing")

	var valid bool
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT convalidated FROM pg_constraint WHERE conname = 'ck_items_impa_code'`).Scan(&valid))
	assert.True(t, valid, "a clean catalog validates the check")
}

// Bad stored codes are kept.
// The Up keeps it, leaves the check unvalidated and still refuses a new
// bad code.
func TestMigration00113_KeepsBadCodes(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := tx.Exec(ctx, downSQL(t, impaMigration))
	require.NoError(t, err)
	tag := fmt.Sprintf("%06d", time.Now().UnixNano()%1_000_000)
	r := seedLegacy(ctx, t, tx, tag, true)

	_, err = tx.Exec(ctx, upSQL(t, impaMigration))
	require.NoError(t, err)

	var code string
	require.NoError(t, tx.QueryRow(ctx, `SELECT impa_code FROM items WHERE id = $1`, r.junk).Scan(&code))
	assert.Equal(t, "J"+tag, code)
	var valid bool
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT convalidated FROM pg_constraint WHERE conname = 'ck_items_impa_code'`).Scan(&valid))
	assert.False(t, valid)

	_, err = tx.Exec(ctx, `SAVEPOINT bad`)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO items (name, impa_code, created_by, updated_by) VALUES ('X', 'ABC', 1, 1)`)
	require.Error(t, err, "a new bad code is refused")
	_, err = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT bad`)
	require.NoError(t, err)
}
