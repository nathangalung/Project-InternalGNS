package quotations_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// sqlState returns the pg code.
// It is "" for a non-pg error.
func sqlState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

// forceStatus bypasses the state machine.
func forceStatus(t *testing.T, ctx context.Context, tx pgx.Tx, id int64, status quotations.Status) {
	t.Helper()
	_, err := tx.Exec(ctx, `UPDATE quotations SET status = $2 WHERE id = $1`, id, status)
	require.NoError(t, err)
}

// DB table matches the map.
// The database transition table must mirror Transitions.
func TestChangeStatus_MirrorsTransitions(t *testing.T) {
	note := "alasan pengujian"
	for _, from := range quotations.Statuses {
		allowed := map[quotations.Status]bool{}
		for _, tr := range quotations.AllowedTransitions(from.Status) {
			allowed[tr.To] = true
		}
		for _, to := range quotations.Statuses {
			if to.Status == from.Status {
				continue
			}
			t.Run(string(from.Status)+"_to_"+string(to.Status), func(t *testing.T) {
				ctx, repo, tx := newRepo(t)
				id, err := repo.Create(ctx, sampleCreate(), seedUserID)
				require.NoError(t, err)
				forceStatus(t, ctx, tx, id, from.Status)

				err = repo.ChangeStatus(ctx, id, to.Status, &note, seedUserID)
				if allowed[to.Status] {
					require.NoError(t, err)
					return
				}
				require.Error(t, err)
				assert.Equal(t, "P0012", sqlState(err), "refusal must be typed: %v", err)
			})
		}
	}
}

func TestChangeStatus_SameStatusIsNoop(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusDraft, nil, seedUserID))
}

func TestChangeStatus_UnknownQuotation(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	err := repo.ChangeStatus(ctx, 9_999_999, quotations.StatusSent, nil, seedUserID)
	require.Error(t, err)
	assert.Equal(t, "P0011", sqlState(err))
}

// Expired is no status.
// A sent quotation stays sent until a user moves it.
func TestChangeStatus_RefusesExpired(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id := sentWithValidity(t, ctx, repo, intPtr(7))
	err := repo.ChangeStatus(ctx, id, "expired", nil, seedUserID)
	require.Error(t, err)
	assert.Equal(t, "P0012", sqlState(err))
}

func TestChangeStatus_RequiresNote(t *testing.T) {
	blank := "   "
	reason := "Klien memilih pemasok lain"
	tests := []struct {
		name string
		from quotations.Status
		to   quotations.Status
		note *string
		code string
	}{
		{"reject without note", quotations.StatusSent, quotations.StatusRejected, nil, "P0014"},
		{"reject blank note", quotations.StatusSent, quotations.StatusRejected, &blank, "P0014"},
		{"reject with note", quotations.StatusSent, quotations.StatusRejected, &reason, ""},
		{"cancel draft without note", quotations.StatusDraft, quotations.StatusCancelled, nil, "P0014"},
		{"cancel revision blank note", quotations.StatusRevision, quotations.StatusCancelled, &blank, "P0014"},
		{"cancel sent with note", quotations.StatusSent, quotations.StatusCancelled, &reason, ""},
		{"send without note", quotations.StatusDraft, quotations.StatusSent, nil, ""},
		{"accept without note", quotations.StatusSent, quotations.StatusAccepted, nil, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			forceStatus(t, ctx, tx, id, tt.from)

			err = repo.ChangeStatus(ctx, id, tt.to, tt.note, seedUserID)
			if tt.code != "" {
				require.Error(t, err)
				assert.Equal(t, tt.code, sqlState(err))
				return
			}
			require.NoError(t, err)
			d, err := repo.GetDetail(ctx, id)
			require.NoError(t, err)
			assert.Equal(t, tt.to, d.Status)
			last := d.History[len(d.History)-1]
			assert.Equal(t, tt.to, last.ToStatus)
			if tt.note != nil {
				require.NotNil(t, last.Note)
				assert.Equal(t, *tt.note, *last.Note)
			}
		})
	}
}

// sentWithValidity creates a sent quotation.
// It carries the given validity window.
func sentWithValidity(t *testing.T, ctx context.Context, repo *quotations.Repo, validity *int) int64 {
	t.Helper()
	req := sampleCreate()
	req.ValidityDays = validity
	id, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	return id
}

func TestRevise_ClonesSentIntoDraft(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	orig, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	_, err = repo.CreateItemRequest(ctx, orig, quotations.ItemRequestCreate{
		LineNo: 1, RequestText: "PUNCHING TOOL",
	}, seedUserID)
	require.NoError(t, err)
	var reqID int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT id FROM quotation_item_requests WHERE quotation_id = $1`, orig).Scan(&reqID))
	_, err = tx.Exec(ctx,
		`UPDATE quotation_items SET request_id = $2 WHERE quotation_id = $1 AND item_type = 'product'`, orig, reqID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, orig, quotations.StatusSent, nil, seedUserID))

	note := "Klien minta harga baru"
	child, err := repo.Revise(ctx, orig, &note, seedUserID)
	require.NoError(t, err)
	require.NotEqual(t, orig, child)

	o, err := repo.GetDetail(ctx, orig)
	require.NoError(t, err)
	c, err := repo.GetDetail(ctx, child)
	require.NoError(t, err)

	assert.Equal(t, quotations.StatusRevision, o.Status)
	last := o.History[len(o.History)-1]
	assert.Equal(t, quotations.StatusRevision, last.ToStatus)
	require.NotNil(t, last.Note)
	assert.Equal(t, note, *last.Note)

	assert.Equal(t, quotations.StatusDraft, c.Status)
	assert.Equal(t, o.Version+1, c.Version)
	assert.Equal(t, o.QuotationNo+" Rev.1", c.QuotationNo)
	assert.Equal(t, o.DiscountPct, c.DiscountPct)
	assert.Equal(t, o.GrandTotal, c.GrandTotal)
	assert.Equal(t, o.ValidityDays, c.ValidityDays)
	require.Len(t, c.Items, len(o.Items))
	for i := range o.Items {
		assert.Equal(t, o.Items[i].SellingPrice, c.Items[i].SellingPrice)
		assert.Equal(t, o.Items[i].ItemType, c.Items[i].ItemType)
		assert.Equal(t, o.Items[i].Qty, c.Items[i].Qty)
	}

	var parent int64
	var childReqs, remapped int
	require.NoError(t, tx.QueryRow(ctx, `SELECT parent_id FROM quotations WHERE id = $1`, child).Scan(&parent))
	assert.Equal(t, orig, parent)
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM quotation_item_requests WHERE quotation_id = $1`, child).Scan(&childReqs))
	assert.Equal(t, 1, childReqs)
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM quotation_items qi
		JOIN quotation_item_requests r ON r.id = qi.request_id
		WHERE qi.quotation_id = $1 AND r.quotation_id = $1`, child).Scan(&remapped))
	assert.Equal(t, 1, remapped, "request links point at the cloned requests")

	revs, err := repo.ListRevisions(ctx, child)
	require.NoError(t, err)
	require.Len(t, revs, 2)

	// The new draft edits like any draft.
	d, err := repo.GetDetail(ctx, child)
	require.NoError(t, err)
	_, err = repo.Update(ctx, child, quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "BOLT M8", Qty: "10", UnitID: seedUnitID, SellingPrice: "20000",
		}},
	}, seedUserID, &d.RowVersion)
	require.NoError(t, err)

	// The superseded original can still close.
	require.NoError(t, repo.ChangeStatus(ctx, orig, quotations.StatusCancelled, &note, seedUserID))
}

// Sent original stays frozen.
// What the client received must not change.
func TestRevise_OriginalIsFrozen(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	orig, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, orig, quotations.StatusSent, nil, seedUserID))
	_, err = repo.Revise(ctx, orig, nil, seedUserID)
	require.NoError(t, err)
	o, err := repo.GetDetail(ctx, orig)
	require.NoError(t, err)

	_, err = repo.Update(ctx, orig, quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "BOLT M8", Qty: "10", UnitID: seedUnitID, SellingPrice: "20000",
		}},
	}, seedUserID, &o.RowVersion)
	require.Error(t, err)
	assert.Equal(t, "P0013", sqlState(err), "a locked status is a conflict: %v", err)
	assert.Contains(t, err.Error(), "Hanya quotation berstatus Draf yang dapat diubah. Status saat ini Revisi.")
}

// Both updates type missing ids.
func TestUpdate_UnknownQuotation(t *testing.T) {
	rv := int32(1)
	for _, tc := range []struct {
		name    string
		ifMatch *int32
	}{{"versioned", &rv}, {"legacy", nil}} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			_, err := repo.Update(ctx, 9_999_999, quotations.UpdateRequest{
				DiscountPct: "0",
				Items: []quotations.CreateItem{{
					RequestedName: "BOLT M8", Qty: "1", UnitID: seedUnitID, SellingPrice: "1",
				}},
			}, seedUserID, tc.ifMatch)
			require.Error(t, err)
			if tc.ifMatch != nil {
				assert.ErrorIs(t, err, quotations.ErrNotFound)
				return
			}
			assert.Equal(t, "P0011", sqlState(err))
		})
	}
}

// learnedMatch reads one cache row.
func learnedMatch(t *testing.T, ctx context.Context, tx pgx.Tx, text string) (int, int64) {
	t.Helper()
	var count int
	var itemID int64
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT match_count, matched_item_id FROM item_request_matches
		WHERE LOWER(TRIM(request_text)) = LOWER(TRIM($1))`, text).Scan(&count, &itemID))
	return count, itemID
}

// Revision copies are not evidence.
// It must neither count again nor restore a mapping learned since.
func TestRevise_DoesNotRelearnMatches(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	text := fmt.Sprintf("REVISE LEARN %d", time.Now().UnixNano())
	var remapped int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, default_unit_id, created_by, updated_by)
		VALUES ($1, $2, $3, $3) RETURNING id`, text+" ALT", seedUnitID, seedUserID).Scan(&remapped))

	first := sampleCreate()
	first.Items[0].RequestedName = text
	orig, err := repo.Create(ctx, first, seedUserID)
	require.NoError(t, err)
	count, item := learnedMatch(t, ctx, tx, text)
	assert.Equal(t, 1, count)
	assert.Equal(t, seedItemID, item)

	later := sampleCreate()
	later.Items[0].RequestedName = text
	later.Items[0].RequestedItemID = &remapped
	_, err = repo.Create(ctx, later, seedUserID)
	require.NoError(t, err)
	count, item = learnedMatch(t, ctx, tx, text)
	require.Equal(t, 2, count, "a new quotation still learns")
	require.Equal(t, remapped, item)

	require.NoError(t, repo.ChangeStatus(ctx, orig, quotations.StatusSent, nil, seedUserID))
	child, err := repo.Revise(ctx, orig, nil, seedUserID)
	require.NoError(t, err)
	count, item = learnedMatch(t, ctx, tx, text)
	assert.Equal(t, 2, count, "the clone is not a new match")
	assert.Equal(t, remapped, item, "the clone keeps the newer mapping")

	// Learning resumes after the clone: a changed match counts.
	d, err := repo.GetDetail(ctx, child)
	require.NoError(t, err)
	_, err = repo.Update(ctx, child, quotations.UpdateRequest{
		DiscountPct: "0",
		Items: []quotations.CreateItem{{
			RequestedItemID: int64Ptr(remapped), RequestedName: text,
			Qty: "1", UnitID: seedUnitID, SellingPrice: "1000",
		}},
	}, seedUserID, &d.RowVersion)
	require.NoError(t, err)
	count, item = learnedMatch(t, ctx, tx, text)
	assert.Equal(t, 3, count, "an edit in the same transaction still learns")
	assert.Equal(t, remapped, item)
}

func TestRevise_NumbersFollowTheChain(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	orig, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, orig, quotations.StatusSent, nil, seedUserID))
	first, err := repo.Revise(ctx, orig, nil, seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, first, quotations.StatusSent, nil, seedUserID))
	second, err := repo.Revise(ctx, first, nil, seedUserID)
	require.NoError(t, err)

	o, err := repo.GetDetail(ctx, orig)
	require.NoError(t, err)
	s, err := repo.GetDetail(ctx, second)
	require.NoError(t, err)
	assert.Equal(t, o.QuotationNo+" Rev.2", s.QuotationNo)
	assert.Equal(t, int16(3), s.Version)

	revs, err := repo.ListRevisions(ctx, orig)
	require.NoError(t, err)
	assert.Len(t, revs, 3)
}

func TestRevise_RefusesOtherStatuses(t *testing.T) {
	for _, s := range quotations.Statuses {
		if s.Status == quotations.StatusSent {
			continue
		}
		t.Run(string(s.Status), func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			forceStatus(t, ctx, tx, id, s.Status)
			_, err = repo.Revise(ctx, id, nil, seedUserID)
			require.Error(t, err)
			assert.Equal(t, "P0012", sqlState(err))
		})
	}
}

func TestRevise_UnknownQuotation(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	_, err := repo.Revise(ctx, 9_999_999, nil, seedUserID)
	require.Error(t, err)
	assert.Equal(t, "P0011", sqlState(err))
}

// Superseded requests stay frozen.
func TestItemRequests_LockedOnRevision(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	forceStatus(t, ctx, tx, id, quotations.StatusRevision)
	_, err = repo.CreateItemRequest(ctx, id, quotations.ItemRequestCreate{
		LineNo: 1, RequestText: "X",
	}, seedUserID)
	require.Error(t, err)
}

func TestStats_EveryStatusInOrder(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	forceStatus(t, ctx, tx, id, quotations.StatusCancelled)

	stats, err := repo.Stats(ctx)
	require.NoError(t, err)
	require.Len(t, stats, len(quotations.Statuses))
	for i, s := range quotations.Statuses {
		assert.Equal(t, s.Status, stats[i].Status)
		assert.Equal(t, s.Label, stats[i].Label)
	}
	var cancelled int64
	for _, s := range stats {
		if s.Status == quotations.StatusCancelled {
			cancelled = s.Count
		}
	}
	assert.GreaterOrEqual(t, cancelled, int64(1))
}
