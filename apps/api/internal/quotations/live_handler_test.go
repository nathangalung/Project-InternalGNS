package quotations_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// userHeader picks the acting user.
const userHeader = "X-Test-User"

// liveServer mounts quotations with a hub.
// The acting user comes from userHeader, so one server serves two editors.
func liveServer(t *testing.T, hub *live.Hub) *httptest.Server {
	t.Helper()
	pool := testutil.Pool(t)
	ctx := context.Background()
	require.NoError(t, testutil.ResetQuotationDomain(ctx, pool))
	t.Cleanup(func() { _ = testutil.ResetQuotationDomain(ctx, pool) })

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			uid := seedUserID
			if v := req.Header.Get(userHeader); v != "" {
				uid, _ = strconv.ParseInt(v, 10, 64)
			}
			next.ServeHTTP(w, req.WithContext(deps.WithUserID(req.Context(), uid)))
		})
	})
	r.Mount("/quotations", quotations.Routes(deps.Deps{Pool: pool, Queries: testutil.Store(t), Live: hub}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// committedEditor adds a second user.
func committedEditor(t *testing.T, name string) int64 {
	t.Helper()
	pool := testutil.Pool(t)
	var id int64
	require.NoError(t, pool.QueryRow(context.Background(), `
		INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
		VALUES ('live.' || clock_timestamp()::text || '@test.local', $1, 'x', 'operational', TRUE, 1, 1)
		RETURNING id`, name).Scan(&id))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM quotation_edit_locks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// liveDraftOver creates a draft over HTTP.
func liveDraftOver(t *testing.T, srv *httptest.Server) (int64, []int64) {
	t.Helper()
	req := sampleCreate()
	req.Items = []quotations.CreateItem{offered(), offered()}
	res := doJSON(t, srv, http.MethodPost, "/quotations/", req)
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var created map[string]int64
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	res.Body.Close()

	res = doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(created["id"], 10), nil)
	defer res.Body.Close()
	var d quotations.QuotationDetail
	require.NoError(t, json.NewDecoder(res.Body).Decode(&d))
	var lines []int64
	for _, it := range d.Items {
		if it.ItemType == "product" {
			lines = append(lines, it.ID)
		}
	}
	return created["id"], lines
}

func as(user int64) map[string]string {
	return map[string]string{userHeader: strconv.FormatInt(user, 10)}
}

// Lock, edit, unlock over HTTP.
func TestHandler_LiveLineFlow(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	budi := committedEditor(t, "Budi")
	id, lines := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)
	line0 := quotations.LinePart(lines[0])

	res := doJSON(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: line0})
	require.Equal(t, http.StatusOK, res.StatusCode)
	var lock quotations.LockResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&lock))
	res.Body.Close()
	assert.Equal(t, line0, lock.Part)
	assert.WithinDuration(t, time.Now().Add(quotations.EditLockTTL), lock.ExpiresAt, 5*time.Second)

	res = doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: line0}, as(budi))
	require.Equal(t, http.StatusConflict, res.StatusCode)
	p := problemOf(t, res)
	assert.Equal(t, httperr.EditLockedCode, p.Code)
	assert.Contains(t, p.Detail, "oleh")

	edited := offered()
	edited.Qty = "4"
	res = doJSON(t, srv, http.MethodPut, base+"/lines/"+strconv.FormatInt(lines[0], 10), edited)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	// The web escapes the part, as encodeURIComponent does.
	res = doJSON(t, srv, http.MethodDelete, base+"/locks/"+url.QueryEscape(line0), nil)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	res = doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: line0}, as(budi))
	res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode, "free again after unlock")

	res = doJSON(t, srv, http.MethodPost, base+"/lines", quotations.AddLinesRequest{Items: []quotations.CreateItem{offered()}})
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var added quotations.AddLinesResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&added))
	res.Body.Close()
	require.Len(t, added.IDs, 1)

	res = doJSON(t, srv, http.MethodPatch, base+"/lines/"+strconv.FormatInt(added.IDs[0], 10)+"/offer",
		quotations.LineOfferRequest{IsAvailable: false})
	res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)

	res = doJSON(t, srv, http.MethodDelete, base+"/lines/"+strconv.FormatInt(added.IDs[0], 10), nil)
	res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)

	res = doJSON(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: quotations.HeaderPart})
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	res = doJSON(t, srv, http.MethodPut, base+"/header", quotations.HeaderRequest{DiscountPct: "5"})
	res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)

	res = doJSON(t, srv, http.MethodGet, base, nil)
	defer res.Body.Close()
	var d quotations.QuotationDetail
	require.NoError(t, json.NewDecoder(res.Body).Decode(&d))
	assert.Equal(t, "5.00", d.DiscountPct)
	require.Len(t, d.Locks, 2, "Budi's line and the header")
}

// Bad live requests are refused.
func TestHandler_LiveRefusals(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, lines := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)
	line := base + "/lines/" + strconv.FormatInt(lines[0], 10)
	zero := offered()
	zero.Qty = "0"

	cases := []struct {
		name   string
		method string
		path   string
		body   any
		raw    string
		want   int
	}{
		{"lock bad id", http.MethodPost, "/quotations/x/locks", quotations.LockRequest{Part: "header"}, "", 400},
		{"lock bad json", http.MethodPost, base + "/locks", nil, "{", 400},
		{"lock no part", http.MethodPost, base + "/locks", quotations.LockRequest{}, "", 422},
		{"unlock bad id", http.MethodDelete, "/quotations/x/locks/header", nil, "", 400},
		{"add bad id", http.MethodPost, "/quotations/x/lines", quotations.AddLinesRequest{}, "", 400},
		{"add bad json", http.MethodPost, base + "/lines", nil, "{", 400},
		{"add to unknown quotation", http.MethodPost, "/quotations/999999999/lines", quotations.AddLinesRequest{Items: []quotations.CreateItem{offered()}}, "", 404},
		{"add nothing", http.MethodPost, base + "/lines", quotations.AddLinesRequest{}, "", 422},
		{"add zero qty", http.MethodPost, base + "/lines", quotations.AddLinesRequest{Items: []quotations.CreateItem{zero}}, "", 422},
		{"edit bad line", http.MethodPut, base + "/lines/x", offered(), "", 400},
		{"edit bad json", http.MethodPut, line, nil, "{", 400},
		{"edit zero qty", http.MethodPut, line, zero, "", 422},
		{"edit without lock", http.MethodPut, line, offered(), "", 409},
		{"offer bad json", http.MethodPatch, line + "/offer", nil, "{", 400},
		{"offer bad line", http.MethodPatch, base + "/lines/x/offer", quotations.LineOfferRequest{}, "", 400},
		{"offer unknown line", http.MethodPatch, base + "/lines/999999999/offer", quotations.LineOfferRequest{}, "", 404},
		{"delete bad line", http.MethodDelete, base + "/lines/x", nil, "", 400},
		{"delete unknown line", http.MethodDelete, base + "/lines/999999999", nil, "", 404},
		{"header bad json", http.MethodPut, base + "/header", nil, "{", 400},
		{"header bad discount", http.MethodPut, base + "/header", quotations.HeaderRequest{DiscountPct: "150"}, "", 422},
		{"header without lock", http.MethodPut, base + "/header", quotations.HeaderRequest{DiscountPct: "5"}, "", 409},
		{"header bad id", http.MethodPut, "/quotations/x/header", quotations.HeaderRequest{DiscountPct: "5"}, "", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var res *http.Response
			if tc.raw != "" {
				req, err := http.NewRequest(tc.method, srv.URL+tc.path, strings.NewReader(tc.raw))
				require.NoError(t, err)
				res, err = srv.Client().Do(req)
				require.NoError(t, err)
			} else {
				res = doJSON(t, srv, tc.method, tc.path, tc.body)
			}
			res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)
		})
	}
}

// streamReader reads SSE frames.
type streamReader struct {
	sc *bufio.Scanner
}

// next returns the next event name.
// Comment lines (pings) count as event "ping".
func (s *streamReader) next(t *testing.T) (string, string) {
	t.Helper()
	event, data := "", ""
	for s.sc.Scan() {
		line := s.sc.Text()
		switch {
		case strings.HasPrefix(line, ":"):
			return "ping", ""
		case strings.HasPrefix(line, "event: "):
			event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "" && event != "":
			return event, data
		}
	}
	return "", ""
}

// Changes reach an open stream.
func TestHandler_EventsStream(t *testing.T) {
	restore := quotations.SetStreamTiming(time.Minute, time.Hour)
	t.Cleanup(restore)
	hub := live.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go live.Listen(ctx, testutil.Pool(t), hub, 10*time.Millisecond)
	srv := liveServer(t, hub)
	id, lines := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+base+"/events", nil)
	require.NoError(t, err)
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "text/event-stream", res.Header.Get("Content-Type"))
	assert.Equal(t, "no-store", res.Header.Get("Cache-Control"))
	stream := &streamReader{sc: bufio.NewScanner(res.Body)}
	ev, _ := stream.next(t)
	require.Equal(t, "ready", ev)

	// LISTEN starts asynchronously; lock until an event arrives.
	got := make(chan [2]string, 1)
	go func() {
		e, d := stream.next(t)
		got <- [2]string{e, d}
	}()
	part := quotations.LinePart(lines[1])
	deadline := time.After(5 * time.Second)
	for {
		r := doJSON(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: part})
		r.Body.Close()
		select {
		case e := <-got:
			assert.Equal(t, "locked", e[0])
			var payload live.Event
			require.NoError(t, json.Unmarshal([]byte(e[1]), &payload))
			assert.Equal(t, live.Event{QuotationID: id, Kind: "locked", Part: part, UserID: seedUserID}, payload)
			return
		case <-time.After(100 * time.Millisecond):
			r := doJSON(t, srv, http.MethodDelete, base+"/locks/"+part, nil)
			r.Body.Close()
		case <-deadline:
			t.Fatal("no event on the stream")
		}
	}
}

// Streams ping, then end.
func TestHandler_EventsStreamPingsAndEnds(t *testing.T) {
	restore := quotations.SetStreamTiming(150*time.Millisecond, 40*time.Millisecond)
	t.Cleanup(restore)
	srv := liveServer(t, live.NewHub())
	id, _ := liveDraftOver(t, srv)

	res := doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10)+"/events", nil)
	defer res.Body.Close()
	stream := &streamReader{sc: bufio.NewScanner(res.Body)}
	ev, _ := stream.next(t)
	require.Equal(t, "ready", ev)
	ev, _ = stream.next(t)
	assert.Equal(t, "ping", ev)
	for ev != "" {
		ev, _ = stream.next(t)
	}
	// The server closed the stream; the client reconnects.
}

// A closing hub ends streams.
func TestHandler_EventsStreamEndsOnShutdown(t *testing.T) {
	restore := quotations.SetStreamTiming(time.Minute, time.Hour)
	t.Cleanup(restore)
	hub := live.NewHub()
	srv := liveServer(t, hub)
	id, _ := liveDraftOver(t, srv)
	res := doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10)+"/events", nil)
	defer res.Body.Close()
	stream := &streamReader{sc: bufio.NewScanner(res.Body)}
	ev, _ := stream.next(t)
	require.Equal(t, "ready", ev)
	hub.Close()
	ev, _ = stream.next(t)
	assert.Empty(t, ev, "the stream ends with the hub")
}

// Streams refuse bad targets.
func TestHandler_EventsRefusals(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	cases := []struct {
		name string
		path string
		want int
	}{
		{"bad id", "/quotations/x/events", 400},
		{"unknown quotation", "/quotations/999999999/events", 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, tc.path, nil)
			res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)
		})
	}

	noHub := liveServer(t, nil)
	id, _ := liveDraftOver(t, noHub)
	res := doJSON(t, noHub, http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10)+"/events", nil)
	res.Body.Close()
	assert.Equal(t, http.StatusServiceUnavailable, res.StatusCode)
}

// Contact changes are header changes.
// Another editor's header claim refuses it with edit_locked; a saved change
// is announced to the open editors.
func TestHandler_ContactChangeIsLive(t *testing.T) {
	pool := testutil.Pool(t)
	hub := live.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go live.Listen(ctx, pool, hub, 10*time.Millisecond)
	srv := liveServer(t, hub)
	id, _ := liveDraftOver(t, srv)
	alt := insertContact(t, seedCompanyID, "Kontak Pengganti")
	budi := committedEditor(t, "Budi")
	base := "/quotations/" + strconv.FormatInt(id, 10)
	body := `{"contactId":` + strconv.FormatInt(alt, 10) + `}`

	res := doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: "header"}, as(budi))
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	res = doRaw(t, http.MethodPatch, srv.URL+base+"/contact", body, nil)
	e := problemOf(t, res)
	assert.Equal(t, http.StatusConflict, res.StatusCode)
	assert.Equal(t, httperr.EditLockedCode, e.Code)
	assert.Equal(t, "Sedang diubah oleh Budi.", e.Detail)
	res = doJSONWithHeaders(t, srv, http.MethodDelete, base+"/locks/header", nil, as(budi))
	res.Body.Close()

	// LISTEN starts asynchronously; probe until it delivers.
	events, stop := hub.Subscribe(id)
	defer stop()
	probe := `{"quotationId": ` + strconv.FormatInt(id, 10) + `, "kind": "probe", "userId": 0}`
	deadline := time.After(5 * time.Second)
probing:
	for {
		_, err := pool.Exec(ctx, "SELECT pg_notify($1, $2)", live.Channel, probe)
		require.NoError(t, err)
		for {
			select {
			case ev := <-events:
				if ev.Kind == "probe" {
					break probing
				}
				continue
			case <-time.After(50 * time.Millisecond):
			case <-deadline:
				t.Fatal("listener never delivered")
			}
			break
		}
	}

	res = doRaw(t, http.MethodPatch, srv.URL+base+"/contact", body, nil)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	// Late probes may still be queued; skip them.
	notice := time.After(5 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev.Kind == "probe" {
				continue
			}
			assert.Equal(t, live.Event{QuotationID: id, Kind: "header", Part: "header", UserID: seedUserID}, ev)
			return
		case <-notice:
			t.Fatal("no notice for the contact change")
		}
	}
}
