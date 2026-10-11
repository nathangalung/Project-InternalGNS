package quotations_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// unpricedLine waits for a head.
func unpricedLine() quotations.CreateItem {
	it := offered()
	it.SellingPrice = "0"
	return it
}

// guardDraft is a head's draft.
// Its first line carries a harga jual, its second waits for one.
func guardDraft(t *testing.T, srv *httptest.Server) (id, priced, unpriced int64) {
	t.Helper()
	req := sampleCreate()
	req.Items = []quotations.CreateItem{offered(), unpricedLine()}
	res := doJSON(t, srv, http.MethodPost, "/quotations/", req)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var created quotations.CreatedResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	res.Body.Close()
	var lines []int64
	for _, it := range readDetail(t, srv, created.ID).Items {
		if it.ItemType == "product" {
			lines = append(lines, it.ID)
		}
	}
	require.Len(t, lines, 2)
	return created.ID, lines[0], lines[1]
}

// lineState reads one line back.
func lineState(t *testing.T, srv *httptest.Server, id, lineID int64) (bool, string) {
	t.Helper()
	for _, it := range readDetail(t, srv, id).Items {
		if it.ID == lineID {
			return it.IsAvailable, it.SellingPrice
		}
	}
	t.Fatalf("line %d not found", lineID)
	return false, ""
}

// markLine changes availability over HTTP.
// "offer" is the Tidak Ditawarkan toggle, "save" the claimed line save.
func markLine(t *testing.T, srv *httptest.Server, via, role string, id, lineID int64, available bool) *http.Response {
	t.Helper()
	base := "/quotations/" + strconv.FormatInt(id, 10)
	line := base + "/lines/" + strconv.FormatInt(lineID, 10)
	if via == "offer" {
		return doJSONWithHeaders(t, srv, http.MethodPatch, line+"/offer",
			quotations.LineOfferRequest{IsAvailable: available}, asRole(role))
	}
	res := doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks",
		quotations.LockRequest{Part: quotations.LinePart(lineID)}, asRole(role))
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	item := offered()
	item.IsAvailable = boolPtr(available)
	return doJSONWithHeaders(t, srv, http.MethodPut, line, item, asRole(role))
}

// A priced line stays on offer for input.
// Operational input sets no selling figure, and Tidak Ditawarkan stores
// harga jual 0, so it may mark only a line no head has priced. Heads mark
// any line, and nothing changes on a line it may mark.
func TestHandler_InputNoOfferGuard(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	cases := []struct {
		name          string
		role          string
		via           string
		priced        bool
		available     bool
		wantStatus    int
		wantAvailable bool
		wantPrice     string
	}{
		{"input toggle on a priced line", roles.OperationalInput, "offer", true, false, http.StatusForbidden, true, "1500000.00"},
		{"input line save on a priced line", roles.OperationalInput, "save", true, false, http.StatusForbidden, true, "1500000.00"},
		{"input toggle on an unpriced line", roles.OperationalInput, "offer", false, false, http.StatusNoContent, false, "0.00"},
		{"input line save on an unpriced line", roles.OperationalInput, "save", false, false, http.StatusNoContent, false, "0.00"},
		{"input line save keeping a priced line offered", roles.OperationalInput, "save", true, true, http.StatusNoContent, true, "1500000.00"},
		{"operational toggle on a priced line", roles.Operational, "offer", true, false, http.StatusNoContent, false, "0.00"},
		{"superadmin line save on a priced line", roles.Superadmin, "save", true, false, http.StatusNoContent, false, "0.00"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, priced, unpriced := guardDraft(t, srv)
			line := unpriced
			if c.priced {
				line = priced
			}
			res := markLine(t, srv, c.via, c.role, id, line, c.available)
			if c.wantStatus == http.StatusForbidden {
				p := problemOf(t, res)
				assert.Equal(t, http.StatusForbidden, p.Status)
				assert.Equal(t, quotations.MsgPricedNoOffer, p.Detail)
			} else {
				res.Body.Close()
				require.Equal(t, c.wantStatus, res.StatusCode)
			}
			available, price := lineState(t, srv, id, line)
			assert.Equal(t, c.wantAvailable, available)
			assert.Equal(t, c.wantPrice, price)
		})
	}
}

// Input restores a no-offer line.
// Back on offer it stays at harga jual 0, so no selling figure changes.
func TestHandler_InputRestoresNoOffer(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	for _, via := range []string{"offer", "save"} {
		t.Run(via, func(t *testing.T) {
			id, priced, _ := guardDraft(t, srv)
			res := markLine(t, srv, "offer", roles.Operational, id, priced, false)
			res.Body.Close()
			require.Equal(t, http.StatusNoContent, res.StatusCode)

			res = markLine(t, srv, via, roles.OperationalInput, id, priced, true)
			res.Body.Close()
			require.Equal(t, http.StatusNoContent, res.StatusCode)
			available, price := lineState(t, srv, id, priced)
			assert.True(t, available)
			assert.Equal(t, "0.00", price, "a head prices it again")
		})
	}
}

// Input's new lines may start unoffered.
// They carry no harga jual yet, on a new draft or added to one. The full
// draft save stays the heads' own.
func TestHandler_InputNewNoOfferLines(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	in := asRole(roles.OperationalInput)
	marked := noOffer()

	req := sampleCreate()
	req.Items = []quotations.CreateItem{offered(), marked}
	res := doJSONWithHeaders(t, srv, http.MethodPost, "/quotations/", req, in)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var created quotations.CreatedResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	res.Body.Close()
	base := "/quotations/" + strconv.FormatInt(created.ID, 10)

	res = doJSONWithHeaders(t, srv, http.MethodPost, base+"/lines",
		quotations.AddLinesRequest{Items: []quotations.CreateItem{marked}}, in)
	res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)

	var unoffered int
	for _, it := range readDetail(t, srv, created.ID).Items {
		if it.ItemType == "product" && !it.IsAvailable {
			unoffered++
			assert.Equal(t, "0.00", it.SellingPrice)
		}
	}
	assert.Equal(t, 2, unoffered)

	res = doJSONWithHeaders(t, srv, http.MethodPut, base,
		quotations.UpdateRequest{DiscountPct: "0", Items: []quotations.CreateItem{marked}}, in)
	p := problemOf(t, res)
	assert.Equal(t, http.StatusForbidden, p.Status)
	assert.Equal(t, rolegate.RefusedDetail, p.Detail)
}

// A sent quotation keeps its draft rule.
// The guard reads only drafts, so input hears why nothing changes.
func TestHandler_InputNoOfferOnSent(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, _ := liveDraftOver(t, srv)
	res := doJSON(t, srv, http.MethodPost, "/quotations/"+strconv.FormatInt(id, 10)+"/send", nil)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	var line int64
	for _, it := range readDetail(t, srv, id).Items {
		if it.ItemType == "product" {
			line = it.ID
			break
		}
	}

	p := problemOf(t, markLine(t, srv, "offer", roles.OperationalInput, id, line, false))
	assert.Equal(t, http.StatusConflict, p.Status)
	assert.Equal(t, "Hanya quotation berstatus Draf yang dapat diubah. Status saat ini Dikirim.", p.Detail)
}

// Guarded saves surface their failures.
// Each runs in its own transaction: no transaction, a failed begin and a
// failed locked read all refuse the save.
func TestRepo_NoOfferGuardFaults(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	calls := map[string]func(*quotations.Repo) error{
		"line save": func(r *quotations.Repo) error {
			return r.UpdateLineKeepingPrice(ctx, 1, 1, offered(), seedUserID)
		},
		"offer toggle": func(r *quotations.Repo) error {
			return r.SetLineOfferKeepingPrice(ctx, 1, 1, false, seedUserID)
		},
	}
	execs := []struct {
		name string
		db   quotations.Executor
		want error
	}{
		{"no transaction", testutil.FakeExec{}, quotations.ErrNoTx},
		{"begin fails", testutil.FailBegin{}, testutil.ErrFake},
		{"lock fails", testutil.FailAtTx{Inner: tx, FailAt: 1}, testutil.ErrFake},
		{"line read fails", testutil.FailAtTx{Inner: tx, FailAt: 2}, testutil.ErrFake},
	}
	for name, call := range calls {
		for _, e := range execs {
			t.Run(name+" "+e.name, func(t *testing.T) {
				assert.ErrorIs(t, call(quotations.NewRepo(e.db, store)), e.want)
			})
		}
	}
}

// The guard waits for a head's price.
// A head pricing the line holds the quotation row; the input toggle reads
// under the same lock, so it sees the price and refuses instead of storing
// harga jual 0 over it.
func TestRepo_NoOfferGuardWaitsForHead(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	require.NoError(t, testutil.ResetQuotationDomain(ctx, pool))
	t.Cleanup(func() { _ = testutil.ResetQuotationDomain(ctx, pool) })
	repo := quotations.NewRepo(pool, testutil.Store(t))
	req := sampleCreate()
	req.Items = []quotations.CreateItem{unpricedLine()}
	id, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	var line int64
	for _, it := range d.Items {
		if it.ItemType == "product" {
			line = it.ID
		}
	}

	head, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = head.Rollback(ctx) }()
	var headPID int32
	require.NoError(t, head.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&headPID))
	_, err = head.Exec(ctx, `SELECT id FROM quotations WHERE id = $1 FOR UPDATE`, id)
	require.NoError(t, err)
	_, err = head.Exec(ctx, `UPDATE quotation_items SET selling_price = 5000 WHERE id = $1`, line)
	require.NoError(t, err)

	done := make(chan error, 1)
	go func() { done <- repo.SetLineOfferKeepingPrice(ctx, id, line, false, seedUserID) }()
	require.Eventually(t, func() bool {
		var waiting bool
		_ = pool.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid)))`, headPID).Scan(&waiting)
		return waiting
	}, 5*time.Second, 10*time.Millisecond, "the toggle waits for the head")
	require.NoError(t, head.Commit(ctx))

	select {
	case err := <-done:
		assert.ErrorIs(t, err, quotations.ErrPricedNoOffer)
	case <-time.After(5 * time.Second):
		t.Fatal("the toggle never returned")
	}
	var available bool
	var price string
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT is_available, selling_price::text FROM quotation_items WHERE id = $1`, line).Scan(&available, &price))
	assert.True(t, available)
	assert.Equal(t, "5000.00", price)
}
