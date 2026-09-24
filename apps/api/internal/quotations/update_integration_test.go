package quotations_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// The database refuses a discount past the handler.
func TestUpdate_DiscountOutOfRangeIsTyped(t *testing.T) {
	cases := []struct {
		name      string
		versioned bool
		discount  string
	}{
		{"versioned above 100", true, "150"},
		{"legacy above 100", false, "150"},
		{"versioned negative", true, "-5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			var ifMatch *int32
			if c.versioned {
				d, err := repo.GetDetail(ctx, id)
				require.NoError(t, err)
				ifMatch = &d.RowVersion
			}

			_, err = repo.Update(ctx, id, quotations.UpdateRequest{
				DiscountPct: c.discount, Items: sampleCreate().Items,
			}, seedUserID, ifMatch)

			var pgErr *pgconn.PgError
			require.True(t, errors.As(err, &pgErr), "want a pg error, got %v", err)
			assert.Equal(t, "P0014", pgErr.Code)
			assert.True(t, strings.HasPrefix(pgErr.Message, "Diskon harus antara 0 dan 100"), pgErr.Message)
			e := httperr.FromDBErr(err)
			assert.Equal(t, http.StatusUnprocessableEntity, e.Status)
			assert.Equal(t, pgErr.Message, e.Detail)
		})
	}
}

// matchCount reads a learned count, 0 when absent.
func matchCount(t *testing.T, ctx context.Context, tx pgx.Tx, text string) (int, int64) {
	t.Helper()
	var count int
	var itemID int64
	err := tx.QueryRow(ctx, `
		SELECT match_count, matched_item_id FROM item_request_matches
		WHERE LOWER(TRIM(request_text)) = LOWER(TRIM($1))`, text).Scan(&count, &itemID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, 0
	}
	require.NoError(t, err)
	return count, itemID
}

func learnLine(name string, itemID int64, qty string) quotations.CreateItem {
	return quotations.CreateItem{
		RequestedItemID: int64Ptr(itemID), RequestedName: name,
		Qty: qty, UnitID: seedUnitID, SellingPrice: "1000",
	}
}

func insertItem(t *testing.T, ctx context.Context, tx pgx.Tx, name string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, default_unit_id, created_by, updated_by)
		VALUES ($1, $2, $3, $3) RETURNING id`, name, seedUnitID, seedUserID).Scan(&id))
	return id
}

// Only a new or changed match is learned.
// Each step saves the whole draft and checks both texts.
func TestUpdate_ResaveLearnsOnlyNewMatches(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	stamp := time.Now().UnixNano()
	a := fmt.Sprintf("RESAVE LEARN A %d", stamp)
	b := fmt.Sprintf("RESAVE LEARN B %d", stamp)
	alt := insertItem(t, ctx, tx, a+" ALT")

	first := sampleCreate()
	first.Items = []quotations.CreateItem{learnLine(a, seedItemID, "1")}
	id, err := repo.Create(ctx, first, seedUserID)
	require.NoError(t, err)
	count, _ := matchCount(t, ctx, tx, a)
	require.Equal(t, 1, count)

	steps := []struct {
		name  string
		items []quotations.CreateItem
		wantA int
		itemA int64
		wantB int
	}{
		{"unchanged resave", []quotations.CreateItem{learnLine(a, seedItemID, "1")}, 1, seedItemID, 0},
		{"quantity edit only", []quotations.CreateItem{learnLine(a, seedItemID, "4")}, 1, seedItemID, 0},
		{"case and spacing only", []quotations.CreateItem{
			learnLine("  "+strings.ToLower(a)+" ", seedItemID, "4"),
		}, 1, seedItemID, 0},
		{"new line learns", []quotations.CreateItem{
			learnLine(a, seedItemID, "4"), learnLine(b, seedItemID, "1"),
		}, 1, seedItemID, 1},
		{"added duplicate learns", []quotations.CreateItem{
			learnLine(a, seedItemID, "4"), learnLine(a, seedItemID, "2"), learnLine(b, seedItemID, "1"),
		}, 2, seedItemID, 1},
		{"remap learns and moves the mapping", []quotations.CreateItem{
			learnLine(a, alt, "4"), learnLine(a, seedItemID, "2"), learnLine(b, seedItemID, "1"),
		}, 3, alt, 1},
		{"remapped resave", []quotations.CreateItem{
			learnLine(a, alt, "4"), learnLine(a, seedItemID, "2"), learnLine(b, seedItemID, "1"),
		}, 3, alt, 1},
	}
	for _, s := range steps {
		_, err := repo.Update(ctx, id, quotations.UpdateRequest{
			DiscountPct: "0", Items: s.items,
		}, seedUserID, nil)
		require.NoError(t, err, s.name)
		count, item := matchCount(t, ctx, tx, a)
		assert.Equal(t, s.wantA, count, s.name)
		assert.Equal(t, s.itemA, item, s.name)
		count, _ = matchCount(t, ctx, tx, b)
		assert.Equal(t, s.wantB, count, s.name)
	}

	// The caller's setting is restored.
	c := fmt.Sprintf("RESAVE LEARN C %d", stamp)
	later := sampleCreate()
	later.Items = []quotations.CreateItem{learnLine(c, seedItemID, "1")}
	_, err = repo.Create(ctx, later, seedUserID)
	require.NoError(t, err)
	count, _ = matchCount(t, ctx, tx, c)
	assert.Equal(t, 1, count, "a later insert in the same transaction still learns")
}

// An outer off switch still wins.
func TestUpdate_KeepsCallerLearningOff(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	text := fmt.Sprintf("RESAVE LEARN OFF %d", time.Now().UnixNano())
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, `SELECT set_config('gns.learn_match', 'off', true)`)
	require.NoError(t, err)
	_, err = repo.Update(ctx, id, quotations.UpdateRequest{
		DiscountPct: "0", Items: []quotations.CreateItem{learnLine(text, seedItemID, "1")},
	}, seedUserID, nil)
	require.NoError(t, err)

	count, _ := matchCount(t, ctx, tx, text)
	assert.Equal(t, 0, count)
	var setting string
	require.NoError(t, tx.QueryRow(ctx, `SELECT current_setting('gns.learn_match', true)`).Scan(&setting))
	assert.Equal(t, "off", setting)
}
