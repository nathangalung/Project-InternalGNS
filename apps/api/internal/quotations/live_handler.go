package quotations

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// Stream clocks.
// A stream is re-opened by the web after streamLifetime, which also bounds
// how long a revoked session keeps receiving change notices; the ping keeps
// proxies from closing an idle connection. Variables so tests can shorten
// them.
var (
	streamLifetime = 5 * time.Minute
	streamPing     = 15 * time.Second
)

// streamWriteWait bounds one write.
const streamWriteWait = 10 * time.Second

// pathIDs reads the quotation id.
// With line set it reads lineId too.
func pathIDs(w http.ResponseWriter, r *http.Request, line bool) (int64, int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return 0, 0, false
	}
	if !line {
		return id, 0, true
	}
	lineID, err := strconv.ParseInt(chi.URLParam(r, "lineId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid line id"))
		return 0, 0, false
	}
	return id, lineID, true
}

// Lock claims or renews a part.
// The web calls it when a part opens and again as a heartbeat.
func (h *Handler) Lock(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathIDs(w, r, false)
	if !ok {
		return
	}
	var req LockRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Part) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"part": "wajib diisi"}))
		return
	}
	until, err := h.repo.Lock(r.Context(), id, req.Part, deps.CurrentUserID(r.Context()))
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, LockResponse{Part: req.Part, ExpiresAt: until})
}

// Unlock frees the caller's claim.
func (h *Handler) Unlock(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathIDs(w, r, false)
	if !ok {
		return
	}
	// chi hands back the segment as sent, and a browser escapes the colon of
	// "line:<id>"; left escaped it would match no claim.
	// net/http has already refused a malformed escape.
	part := chi.URLParam(r, "part")
	if p, err := url.PathUnescape(part); err == nil {
		part = p
	}
	if err := h.repo.Unlock(r.Context(), id, part, deps.CurrentUserID(r.Context())); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AddLines appends product lines.
func (h *Handler) AddLines(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathIDs(w, r, false)
	if !ok {
		return
	}
	var req AddLinesRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.Items) == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"items": "minimal satu baris"}))
		return
	}
	if fields := validateLines(req.Items); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	ids, err := h.repo.AddLines(r.Context(), id, req.Items, deps.CurrentUserID(r.Context()))
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, AddLinesResponse{IDs: ids})
}

// UpdateLine saves one claimed line.
func (h *Handler) UpdateLine(w http.ResponseWriter, r *http.Request) {
	id, lineID, ok := pathIDs(w, r, true)
	if !ok {
		return
	}
	var item CreateItem
	if !httpx.DecodeJSON(w, r, &item) {
		return
	}
	if fields := validateLines([]CreateItem{item}); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if err := h.repo.UpdateLine(r.Context(), id, lineID, item, deps.CurrentUserID(r.Context())); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetLineOffer toggles Tidak Ditawarkan.
func (h *Handler) SetLineOffer(w http.ResponseWriter, r *http.Request) {
	id, lineID, ok := pathIDs(w, r, true)
	if !ok {
		return
	}
	var req LineOfferRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if err := h.repo.SetLineOffer(r.Context(), id, lineID, req.IsAvailable, deps.CurrentUserID(r.Context())); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteLine removes one line.
func (h *Handler) DeleteLine(w http.ResponseWriter, r *http.Request) {
	id, lineID, ok := pathIDs(w, r, true)
	if !ok {
		return
	}
	if err := h.repo.DeleteLine(r.Context(), id, lineID, deps.CurrentUserID(r.Context())); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UpdateHeader saves the claimed header.
func (h *Handler) UpdateHeader(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathIDs(w, r, false)
	if !ok {
		return
	}
	var req HeaderRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if fields := validateDiscountPct(req.DiscountPct); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if fields := validateTerms(req.ValidityDays, req.ShippingDays, req.ShippingCost); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if err := h.repo.UpdateHeader(r.Context(), id, req, deps.CurrentUserID(r.Context())); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Events streams one draft's changes.
//
// Server-sent events: "ready" once, then one event per change, named by its
// kind, with the change as JSON data, plus "resync" when the listener
// reconnected and may have missed changes. The web reloads the quotation on
// each, so an event carries no business data. Comment pings keep proxies from
// closing the idle connection. The stream ends after streamLifetime, when
// the client leaves, or when the server shuts down; the web reconnects
// through the normal authenticated path.
func (h *Handler) Events(w http.ResponseWriter, r *http.Request) {
	if h.live == nil {
		httperr.Render(w, httperr.ServiceUnavailable("live updates unavailable"))
		return
	}
	id, _, ok := pathIDs(w, r, false)
	if !ok {
		return
	}
	if _, err := h.repo.rowVersion(r.Context(), id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.Render(w, httperr.NotFound("quotation not found"))
			return
		}
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	events, stop := h.live.Subscribe(id)
	defer stop()
	rc := http.NewResponseController(w)
	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream")
	hdr.Set("Cache-Control", "no-store")
	hdr.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	write := func(frame string) bool {
		// Each write gets its own deadline instead of the server's.
		_ = rc.SetWriteDeadline(time.Now().Add(streamWriteWait))
		if _, err := io.WriteString(w, frame); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	if !write("event: ready\ndata: {}\n\n") {
		return
	}

	ping := time.NewTicker(streamPing)
	defer ping.Stop()
	end := time.NewTimer(streamLifetime)
	defer end.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-end.C:
			return
		case <-ping.C:
			if !write(": ping\n\n") {
				return
			}
		case ev, open := <-events:
			if !open {
				return
			}
			data, err := json.Marshal(ev)
			if err != nil || !write("event: "+ev.Kind+"\ndata: "+string(data)+"\n\n") {
				return
			}
		}
	}
}
