package items

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

type Handler struct {
	repo *Repo
}

// searchLayerCap bounds one layer read.
// It sits above the catalog size (about 3.1k items, 2.5k vendor offers and
// 3.1k request matches), so the merged total is exact; a layer that reaches
// it is logged.
const searchLayerCap = 5000

// msgIMPATaken sits on impaCode.
const msgIMPATaken = "Kode IMPA ini sudah dipakai produk aktif lain."

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// renderSaveErr maps save failures.
func renderSaveErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrIMPATaken) {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"impaCode": msgIMPATaken}))
		return
	}
	httperr.RenderDBErrCtx(r.Context(), w, err)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := paginate.Parse(r)
	q := r.URL.Query()
	if key := badQueryParam(q); key != "" {
		httperr.Render(w, httperr.BadRequest("invalid text in query parameter "+key))
		return
	}

	f := ListFilter{
		Q:       strings.TrimSpace(q.Get("q")),
		SortBy:  q.Get("sortBy"),
		SortDir: q.Get("sortDir"),
		Limit:   limit,
		Offset:  offset,
	}
	if s := q.Get("isActive"); s != "" {
		if v, err := strconv.ParseBool(s); err == nil {
			f.IsActive = &v
		}
	}
	if s := q.Get("unitId"); s != "" {
		v, err := strconv.ParseInt(s, 10, 16)
		if err != nil {
			httperr.Render(w, httperr.BadRequest("invalid unitId"))
			return
		}
		u := int16(v)
		f.UnitID = &u
	}

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.Header().Set("X-Total-Count", strconv.FormatInt(res.Total, 10))
	httpx.WriteJSON(w, http.StatusOK, res.Rows)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	item, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("item not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateItemRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	item, err := h.repo.Create(r.Context(), req, userID)
	if err != nil {
		renderSaveErr(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, item)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req UpdateItemRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	item, err := h.repo.Update(r.Context(), id, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("item not found"))
		return
	}
	if err != nil {
		renderSaveErr(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) AddVendor(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req AddVendorToItemRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if req.VendorID <= 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"vendorId": "required"}))
		return
	}
	// A blank cost is stored as zero, so only a typed one is screened.
	if req.CostPrice != nil && strings.TrimSpace(*req.CostPrice) != "" {
		if msg := validate.NonNegative("Harga beli", *req.CostPrice); msg != "" {
			httperr.Render(w, httperr.Unprocessable(map[string]string{"costPrice": msg}))
			return
		}
	}

	userID := deps.CurrentUserID(r.Context())
	row, err := h.repo.AddVendor(r.Context(), id, req, userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrVendorNotFound):
			httperr.Render(w, httperr.NotFound("vendor not found"))
			return
		case errors.Is(err, ErrVendorInactive):
			httperr.Render(w, httperr.Unprocessable(map[string]string{
				"vendorId": "Vendor sudah nonaktif. Aktifkan vendor itu atau pilih vendor lain.",
			}))
			return
		}
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, row)
}

// SearchAdvanced merges three search layers.
// They are item name, vendor offer and request history.
// Tier weight: ITEM_AUTO > VENDOR_OFFER > ITEM_SUGGESTED > REQUEST_HISTORY > ITEM_FUZZY.
func (h *Handler) SearchAdvanced(w http.ResponseWriter, r *http.Request) {
	if key := badQueryParam(r.URL.Query()); key != "" {
		httperr.Render(w, httperr.BadRequest("invalid text in query parameter "+key))
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		httperr.Render(w, httperr.BadRequest("q is required"))
		return
	}

	minScore := float32(0.3)
	if s := r.URL.Query().Get("minScore"); s != "" {
		if v, err := strconv.ParseFloat(s, 32); err == nil {
			minScore = float32(v)
		}
	}
	limit := paginate.ParseLimit(r, 20)
	_, offset := paginate.Parse(r)

	var onlyActive *bool
	if s := r.URL.Query().Get("isActive"); s != "" {
		if v, err := strconv.ParseBool(s); err == nil {
			onlyActive = &v
		}
	}

	ctx := r.Context()
	var items []SearchResult
	var offers []VendorOfferHit
	var requests []RequestHistoryHit

	// Every layer is read whole: paging needs the full merged set, and a
	// window per layer would cut the vendor-offer layer by item id, not score.
	eg, egCtx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		var err error
		items, err = h.repo.SearchCatalog(egCtx, q, minScore, searchLayerCap, onlyActive)
		return err
	})
	eg.Go(func() error {
		var err error
		offers, err = h.repo.SearchVendorOffers(egCtx, q, searchLayerCap, onlyActive)
		return err
	})
	eg.Go(func() error {
		var err error
		requests, err = h.repo.SearchRequestHistory(egCtx, q, searchLayerCap, onlyActive)
		return err
	})
	if err := eg.Wait(); err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	if len(items) == searchLayerCap || len(offers) == searchLayerCap || len(requests) == searchLayerCap {
		slog.WarnContext(ctx, "search-advanced layer reached its cap; total is a lower bound",
			"cap", searchLayerCap, "items", len(items), "offers", len(offers), "requests", len(requests))
	}

	// Read the real flag and catalog identity per candidate; the vendor-offer
	// and request-history layers carry no item name.
	meta, err := h.repo.ItemMetaByIDs(ctx, candidateItemIDs(items, offers, requests))
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	resp := mergeAdvanced(q, items, offers, requests, meta, onlyActive, limit, offset)
	w.Header().Set("X-Total-Count", strconv.Itoa(resp.Total))
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// MaxMatchRows bounds one match batch.
// The whole import holds one transaction and one pool connection, so an
// unbounded batch would hold them indefinitely. POST /quotations/rfq holds
// an upload to the same cap, since the wizard matches it in one call.
const MaxMatchRows = 500

// MatchRows batch-matches imported xlsx rows.
// IMPA exact wins; else fuzzy.
// No-match rows return Matched=nil so FE keeps row empty.
func (h *Handler) MatchRows(w http.ResponseWriter, r *http.Request) {
	var req MatchRowsRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if len(req.Rows) == 0 {
		httpx.WriteJSON(w, http.StatusOK, MatchRowsResponse{Rows: []MatchRowResult{}})
		return
	}
	if len(req.Rows) > MaxMatchRows {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"rows": fmt.Sprintf("Terlalu banyak baris dalam satu permintaan: paling banyak %d. Bagi menjadi beberapa kelompok.", MaxMatchRows),
		}))
		return
	}
	minScore := req.MinScore
	if minScore <= 0 {
		minScore = 0.5
	}

	ctx := r.Context()
	out, err := h.repo.MatchRows(ctx, req, minScore, deps.CurrentUserID(ctx))
	if err != nil {
		httperr.RenderDBErrCtx(ctx, w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, MatchRowsResponse{Rows: out})
}

func (h *Handler) ListVendorsForItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	if err := h.requireItem(r.Context(), id); err != nil {
		renderItemErr(w, r, err)
		return
	}
	vendors, err := h.repo.ListVendorsForItem(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, vendors)
}

func (h *Handler) PriceHistory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	limit := paginate.ParseLimit(r, 5)

	if err := h.requireItem(r.Context(), id); err != nil {
		renderItemErr(w, r, err)
		return
	}
	history, err := h.repo.SuggestSellingPrices(r.Context(), id, limit)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, history)
}

// requireItem checks the parent exists.
// It runs before a sub-collection read.
func (h *Handler) requireItem(ctx context.Context, id int64) error {
	_, err := h.repo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("load item %d: %w", id, err)
	}
	return nil
}

// renderItemErr maps sentinels to problems.
func renderItemErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("item not found"))
		return
	}
	httperr.RenderDBErrCtx(r.Context(), w, err)
}

// maxRecommendIDs caps one request.
// It matches the RFQ import's row cap, so one import is one call.
const maxRecommendIDs = 500

// Recommendations returns line defaults.
// GET /items/recommendations?itemIds=1,2&clientId=3. clientId is optional;
// without it no client's own history is preferred.
func (h *Handler) Recommendations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ids, ok := parseIDList(q.Get("itemIds"))
	if !ok || len(ids) == 0 || len(ids) > maxRecommendIDs {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"itemIds": "Isi 1 sampai 500 id produk, dipisah koma.",
		}))
		return
	}
	var clientID *int64
	if raw := q.Get("clientId"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			httperr.Render(w, httperr.Unprocessable(map[string]string{"clientId": "Klien tidak ditemukan. Muat ulang halaman."}))
			return
		}
		clientID = &id
	}
	recs, err := h.repo.Recommend(r.Context(), clientID, ids)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, recs)
}

// parseIDList reads comma-separated ids.
// Every entry must be a positive integer; duplicates are kept once.
func parseIDList(raw string) ([]int64, bool) {
	if strings.TrimSpace(raw) == "" {
		return nil, true
	}
	parts := strings.Split(raw, ",")
	seen := make(map[int64]struct{}, len(parts))
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64)
		if err != nil || id <= 0 {
			return nil, false
		}
		if _, dup := seen[id]; !dup {
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out, true
}

// RecentQuotations lists the product's newest quotations.
// GET /items/{id}/quotations; the newest RecentQuotationCount lines.
func (h *Handler) RecentQuotations(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	if err := h.requireItem(r.Context(), id); err != nil {
		renderItemErr(w, r, err)
		return
	}
	rows, err := h.repo.RecentQuotations(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}
