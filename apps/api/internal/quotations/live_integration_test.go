package quotations_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// newEditor inserts a second user.
func newEditor(t *testing.T, ctx context.Context, tx pgx.Tx, name string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
		VALUES ('editor.' || clock_timestamp()::text || '@test.local', $1, 'x', 'operational', TRUE, 1, 1)
		RETURNING id`, name).Scan(&id))
	return id
}

// liveDraft is a draft with three lines.
type liveDraft struct {
	id    int64
	lines []int64 // product line ids, in line order
}

func newLiveDraft(t *testing.T, ctx context.Context, repo *quotations.Repo) liveDraft {
	t.Helper()
	id := createWith(t, ctx, repo, offered(), offered(), offered())
	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	var lines []int64
	for _, it := range d.Items {
		if it.ItemType == "product" {
			lines = append(lines, it.ID)
		}
	}
	require.Len(t, lines, 3)
	return liveDraft{id: id, lines: lines}
}

func part(line int64) string { return quotations.LinePart(line) }

// errCode reads the problem code.
func errCode(err error) (int, string, string) {
	e := httperr.FromDBErr(err)
	return e.Status, e.Code, e.Detail
}

// Locks: win, renew, lose, expire.
func TestLock_Rules(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")

	first, err := repo.Lock(ctx, q.id, part(q.lines[0]), seedUserID)
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now().Add(quotations.EditLockTTL), first, 5*time.Second)

	_, err = repo.Lock(ctx, q.id, part(q.lines[0]), seedUserID)
	require.NoError(t, err, "a heartbeat renews the own lock")

	err = attempt(t, ctx, tx, func() error {
		_, e := repo.Lock(ctx, q.id, part(q.lines[0]), budi)
		return e
	})
	status, code, detail := errCode(err)
	assert.Equal(t, 409, status)
	assert.Equal(t, httperr.EditLockedCode, code)
	assert.Regexp(t, `^Sedang diubah oleh .+\.$`, detail)

	_, err = repo.Lock(ctx, q.id, part(q.lines[1]), budi)
	require.NoError(t, err, "another line is free")

	_, err = tx.Exec(ctx, `UPDATE quotation_edit_locks SET expires_at = NOW() - interval '1 second'
		WHERE quotation_id = $1 AND part = $2`, q.id, part(q.lines[0]))
	require.NoError(t, err)
	_, err = repo.Lock(ctx, q.id, part(q.lines[0]), budi)
	require.NoError(t, err, "an expired lock is free")
}

// Bad lock targets are refused.
func TestLock_RefusesBadTargets(t *testing.T) {
	cases := []struct {
		name   string
		part   func(q liveDraft) string
		sent   bool
		status int
	}{
		{"unknown line", func(liveDraft) string { return "line:999999999" }, false, 404},
		{"malformed part", func(liveDraft) string { return "everything" }, false, 422},
		{"sent quotation", func(q liveDraft) string { return "header" }, true, 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			q := newLiveDraft(t, ctx, repo)
			if tc.sent {
				forceStatus(t, ctx, tx, q.id, quotations.StatusSent)
			}
			_, err := repo.Lock(ctx, q.id, tc.part(q), seedUserID)
			status, _, _ := errCode(err)
			assert.Equal(t, tc.status, status)
		})
	}
}

// Unlock frees only the own lock.
func TestUnlock_OnlyOwn(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")
	_, err := repo.Lock(ctx, q.id, "header", seedUserID)
	require.NoError(t, err)

	require.NoError(t, repo.Unlock(ctx, q.id, "header", budi))
	locks, err := repo.EditLocks(ctx, q.id)
	require.NoError(t, err)
	require.Len(t, locks, 1, "someone else's unlock changes nothing")
	assert.Equal(t, seedUserID, locks[0].UserID)

	require.NoError(t, repo.Unlock(ctx, q.id, "header", seedUserID))
	locks, err = repo.EditLocks(ctx, q.id)
	require.NoError(t, err)
	assert.Empty(t, locks)
}

// A line edit needs its lock.
func TestUpdateLine_NeedsTheLock(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")
	line := offered()
	line.SellingPrice = "2000000"

	err := attempt(t, ctx, tx, func() error { return repo.UpdateLine(ctx, q.id, q.lines[0], line, seedUserID) })
	_, code, detail := errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code)
	assert.Equal(t, "Waktu mengubah bagian ini sudah habis. Buka lagi lalu simpan kembali.", detail)

	_, err = repo.Lock(ctx, q.id, part(q.lines[0]), budi)
	require.NoError(t, err)
	err = attempt(t, ctx, tx, func() error { return repo.UpdateLine(ctx, q.id, q.lines[0], line, seedUserID) })
	_, code, detail = errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code)
	assert.Contains(t, detail, "Budi")
}

// Two editors, two lines, one draft.
func TestUpdateLine_ParallelEditors(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")

	_, err := repo.Lock(ctx, q.id, part(q.lines[0]), seedUserID)
	require.NoError(t, err)
	_, err = repo.Lock(ctx, q.id, part(q.lines[2]), budi)
	require.NoError(t, err)

	mine := offered()
	mine.Qty, mine.SellingPrice = "3", "1000000"
	theirs := offered()
	theirs.Qty, theirs.SellingPrice = "1", "500000"
	require.NoError(t, repo.UpdateLine(ctx, q.id, q.lines[0], mine, seedUserID))
	require.NoError(t, repo.UpdateLine(ctx, q.id, q.lines[2], theirs, budi))

	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	byID := map[int64]quotations.QuotationItem{}
	for _, it := range d.Items {
		byID[it.ID] = it
	}
	assert.Equal(t, "3.00", byID[q.lines[0]].Qty, "ids stay stable")
	assert.Equal(t, "500000.00", byID[q.lines[2]].SellingPrice)
	// 3 x 1.000.000 + 2 x 1.500.000 + 1 x 500.000
	assert.Equal(t, "6500000.00", d.TotalProduk)
}

// Added lines go before shipping.
func TestAddLines(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	ids, err := repo.AddLines(ctx, q.id, []quotations.CreateItem{offered(), noOffer()}, seedUserID)
	require.NoError(t, err)
	require.Len(t, ids, 2)

	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	last := d.Items[len(d.Items)-1]
	assert.Equal(t, "shipping", last.ItemType, "the shipping line stays last")
	assert.Equal(t, ids[0], d.Items[3].ID)
	assert.False(t, d.Items[4].IsAvailable, "lines pass through fn_prepare_quotation_lines")
	assert.Equal(t, "0.00", d.Items[4].SellingPrice)
	// Four offered lines at 2 x 1.500.000.
	assert.Equal(t, "12000000.00", d.TotalProduk)

	_, err = repo.AddLines(ctx, q.id, nil, seedUserID)
	status, _, _ := errCode(err)
	assert.Equal(t, 422, status)
}

// An imported line may lack its unit.
// The unit is then filled through the line edit, before sending.
func TestAddLines_WithoutUnit(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	bare := offered()
	bare.UnitID = 0
	ids, err := repo.AddLines(ctx, q.id, []quotations.CreateItem{bare}, seedUserID)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	for _, it := range d.Items {
		if it.ID == ids[0] {
			assert.Nil(t, it.UnitID)
			return
		}
	}
	t.Fatalf("line %d not stored", ids[0])
}

// Tidak Ditawarkan by toggle.
func TestSetLineOffer(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	require.NoError(t, repo.SetLineOffer(ctx, q.id, q.lines[1], false, seedUserID))

	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	line := d.Items[1]
	assert.False(t, line.IsAvailable)
	assert.Equal(t, "0.00", line.SellingPrice)
	assert.Nil(t, line.VendorProductID)
	assert.Equal(t, "6000000.00", d.TotalProduk)

	require.NoError(t, repo.SetLineOffer(ctx, q.id, q.lines[1], true, seedUserID))
	d, err = repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	assert.True(t, d.Items[1].IsAvailable)

	budi := newEditor(t, ctx, tx, "Budi")
	_, err = repo.Lock(ctx, q.id, part(q.lines[1]), budi)
	require.NoError(t, err)
	err = attempt(t, ctx, tx, func() error { return repo.SetLineOffer(ctx, q.id, q.lines[1], false, seedUserID) })
	_, code, _ := errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code, "a line someone is editing cannot be toggled")
}

// Delete keeps one line.
func TestDeleteLine(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")

	_, err := repo.Lock(ctx, q.id, part(q.lines[0]), budi)
	require.NoError(t, err)
	err = attempt(t, ctx, tx, func() error { return repo.DeleteLine(ctx, q.id, q.lines[0], seedUserID) })
	_, code, _ := errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code)

	_, err = repo.Lock(ctx, q.id, part(q.lines[1]), seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.DeleteLine(ctx, q.id, q.lines[1], seedUserID))
	require.NoError(t, repo.Unlock(ctx, q.id, part(q.lines[0]), budi))
	require.NoError(t, repo.DeleteLine(ctx, q.id, q.lines[2], seedUserID))

	err = attempt(t, ctx, tx, func() error { return repo.DeleteLine(ctx, q.id, q.lines[0], seedUserID) })
	status, _, detail := errCode(err)
	assert.Equal(t, 422, status)
	assert.Equal(t, "Quotation harus memiliki minimal satu baris.", detail)

	locks, err := repo.EditLocks(ctx, q.id)
	require.NoError(t, err)
	assert.Empty(t, locks, "a deleted line takes its lock with it")
	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	assert.Equal(t, "3000000.00", d.TotalProduk)
}

// The header needs its lock.
func TestUpdateHeader(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	ship, days, ref := "150000", 5, "PO-LIVE"
	req := quotations.HeaderRequest{DiscountPct: "20", ShippingCost: &ship, ShippingDays: &days, ClientRefNo: &ref}

	err := attempt(t, ctx, tx, func() error { return repo.UpdateHeader(ctx, q.id, req, seedUserID) })
	_, code, _ := errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code)

	_, err = repo.Lock(ctx, q.id, "header", seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.UpdateHeader(ctx, q.id, req, seedUserID))

	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	assert.Equal(t, "20.00", d.DiscountPct)
	require.NotNil(t, d.ClientRefNo)
	assert.Equal(t, ref, *d.ClientRefNo)
	assert.Equal(t, "9000000.00", d.TotalProduk)
	assert.Equal(t, "1800000.00", d.TotalDiscount, "the discount reaches every line")
	assert.Equal(t, "9150000.00", d.Total)
	last := d.Items[len(d.Items)-1]
	assert.Equal(t, "shipping", last.ItemType)
	assert.Equal(t, "150000.00", last.SellingPrice)

	// No address and no cost: the shipping line goes.
	require.NoError(t, repo.UpdateHeader(ctx, q.id, quotations.HeaderRequest{DiscountPct: "0"}, seedUserID))
	d, err = repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	for _, it := range d.Items {
		assert.NotEqual(t, "shipping", it.ItemType)
	}
	assert.Equal(t, "9000000.00", d.Total)
}

// Live totals equal a whole save.
func TestRecompute_MatchesWholeSave(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	frac := offered()
	frac.Qty, frac.SellingPrice = "2.35", "1333.33"
	_, err := repo.AddLines(ctx, q.id, []quotations.CreateItem{frac}, seedUserID)
	require.NoError(t, err)
	_, err = repo.Lock(ctx, q.id, "header", seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.UpdateHeader(ctx, q.id, quotations.HeaderRequest{DiscountPct: "7.5"}, seedUserID))
	live, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)

	whole := createWith(t, ctx, repo, offered(), offered(), offered(), frac)
	_, err = repo.Update(ctx, whole, quotations.UpdateRequest{
		DiscountPct: "7.5",
		Items:       []quotations.CreateItem{offered(), offered(), offered(), frac},
	}, seedUserID, nil)
	require.NoError(t, err)
	saved, err := repo.GetDetail(ctx, whole)
	require.NoError(t, err)

	assert.Equal(t, saved.TotalProduk, live.TotalProduk)
	assert.Equal(t, saved.TotalDiscount, live.TotalDiscount)
	assert.Equal(t, saved.Total, live.Total)
}

// Whole saves wait for other editors.
func TestWholeSave_WaitsForOtherEditors(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")
	_, err := repo.Lock(ctx, q.id, part(q.lines[0]), budi)
	require.NoError(t, err)

	req := quotations.UpdateRequest{DiscountPct: "0", Items: []quotations.CreateItem{offered()}}
	err = attempt(t, ctx, tx, func() error {
		_, e := repo.Update(ctx, q.id, req, seedUserID, nil)
		return e
	})
	_, code, detail := errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code)
	assert.Equal(t, "Quotation sedang diubah oleh Budi. Tunggu sampai selesai.", detail)

	err = attempt(t, ctx, tx, func() error { return repo.ChangeStatus(ctx, q.id, quotations.StatusSent, nil, seedUserID) })
	_, code, _ = errCode(err)
	assert.Equal(t, httperr.EditLockedCode, code, "sending waits too")
}

// Own locks clear on save, send.
func TestWholeSave_ClearsOwnLineLocks(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	_, err := repo.Lock(ctx, q.id, part(q.lines[0]), seedUserID)
	require.NoError(t, err)
	_, err = repo.Lock(ctx, q.id, "header", seedUserID)
	require.NoError(t, err)

	req := quotations.UpdateRequest{DiscountPct: "0", Items: []quotations.CreateItem{offered()}}
	_, err = repo.Update(ctx, q.id, req, seedUserID, nil)
	require.NoError(t, err)
	locks, err := repo.EditLocks(ctx, q.id)
	require.NoError(t, err)
	require.Len(t, locks, 1, "line ids changed, so only the header lock is left")
	assert.Equal(t, "header", locks[0].Part)

	require.NoError(t, repo.ChangeStatus(ctx, q.id, quotations.StatusSent, nil, seedUserID))
	locks, err = repo.EditLocks(ctx, q.id)
	require.NoError(t, err)
	assert.Empty(t, locks, "a sent quotation has nothing to edit")
}

// The detail lists live locks.
func TestDetail_ListsLiveLocks(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	q := newLiveDraft(t, ctx, repo)
	budi := newEditor(t, ctx, tx, "Budi")
	_, err := repo.Lock(ctx, q.id, part(q.lines[1]), budi)
	require.NoError(t, err)
	_, err = repo.Lock(ctx, q.id, "header", seedUserID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE quotation_edit_locks SET expires_at = NOW() - interval '1 second'
		WHERE quotation_id = $1 AND part = 'header'`, q.id)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, q.id)
	require.NoError(t, err)
	require.Len(t, d.Locks, 1, "an expired lock is not shown")
	assert.Equal(t, part(q.lines[1]), d.Locks[0].Part)
	assert.Equal(t, "Budi", d.Locks[0].UserName)
}

// attempt runs one refused call.
// A raised error aborts the test transaction, so the call runs inside a
// savepoint that is rolled back when it fails.
func attempt(t *testing.T, ctx context.Context, tx pgx.Tx, call func() error) error {
	t.Helper()
	_, err := tx.Exec(ctx, "SAVEPOINT attempt")
	require.NoError(t, err)
	callErr := call()
	if callErr != nil {
		_, err = tx.Exec(ctx, "ROLLBACK TO SAVEPOINT attempt")
	} else {
		_, err = tx.Exec(ctx, "RELEASE SAVEPOINT attempt")
	}
	require.NoError(t, err)
	return callErr
}
