package items

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := paginate.Parse(r)
	q := r.URL.Query()

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
		if v, err := strconv.ParseInt(s, 10, 16); err == nil {
			u := int16(v)
			f.UnitID = &u
		}
	}

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
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
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, item)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	item, err := h.repo.Create(r.Context(), req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
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
		httperr.RenderDBErr(w, err)
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.VendorID <= 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"vendorId": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	row, err := h.repo.AddVendor(r.Context(), id, req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, row)
}

func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
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
	limit := paginate.ParseLimit(r, 10)

	results, err := h.repo.Search(r.Context(), q, minScore, limit)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, results)
}

// SearchAdvanced merges item-name, vendor-offer and request-history layers.
// Tier weight: ITEM_AUTO > VENDOR_OFFER > ITEM_SUGGESTED > REQUEST_HISTORY > ITEM_FUZZY.
func (h *Handler) SearchAdvanced(w http.ResponseWriter, r *http.Request) {
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

	var onlyActive *bool
	if s := r.URL.Query().Get("isActive"); s != "" {
		if v, err := strconv.ParseBool(s); err == nil {
			onlyActive = &v
		}
	}

	ctx := r.Context()
	perTier := limit * 2

	var items []SearchResult
	var offers []VendorOfferHit
	var requests []RequestHistoryHit

	eg, egCtx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		var err error
		items, err = h.repo.Search(egCtx, q, minScore, perTier)
		return err
	})
	eg.Go(func() error {
		var err error
		offers, err = h.repo.SearchVendorOffers(egCtx, q, perTier)
		return err
	})
	eg.Go(func() error {
		var err error
		requests, err = h.repo.SearchRequestHistory(egCtx, q, perTier)
		return err
	})
	if err := eg.Wait(); err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	// fn_search_items filters to active items, but the vendor-offer and
	// request-history layers do not, so read the real flag and catalog identity
	// per candidate (those layers carry no item name).
	meta, err := h.repo.ItemMetaByIDs(ctx, candidateItemIDs(items, offers, requests))
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	resp := mergeAdvanced(q, items, offers, requests, meta, onlyActive, limit)
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) MatchRequest(w http.ResponseWriter, r *http.Request) {
	var req MatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.ReqText == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"reqText": "required"}))
		return
	}
	if req.Limit <= 0 {
		req.Limit = 5
	}

	matches, err := h.repo.MatchRequest(r.Context(), req.ReqText, req.Limit)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, matches)
}

// MatchRows: batch match xlsx-imported rows. IMPA exact wins; else fuzzy.
// No-match rows return Matched=nil so FE keeps row empty.
func (h *Handler) MatchRows(w http.ResponseWriter, r *http.Request) {
	var req MatchRowsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if len(req.Rows) == 0 {
		httpx.WriteJSON(w, http.StatusOK, MatchRowsResponse{Rows: []MatchRowResult{}})
		return
	}
	// Bound the batch: each row runs 1-3 sequential queries on one connection,
	// so an unbounded batch holds a pool connection open indefinitely.
	const maxMatchRows = 500
	if len(req.Rows) > maxMatchRows {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"rows": fmt.Sprintf("too many rows in one request; split into batches of %d", maxMatchRows),
		}))
		return
	}
	minScore := req.MinScore
	if minScore <= 0 {
		minScore = 0.5
	}

	ctx := r.Context()
	userID := deps.CurrentUserID(ctx)
	// Dedup auto-created rows within this batch by impa-or-normalized-name.
	created := map[string]int64{}
	out := make([]MatchRowResult, 0, len(req.Rows))
	for i, row := range req.Rows {
		res := MatchRowResult{Index: i, Requested: row, Source: "NONE"}
		var itemID int64
		var confidence float32
		var source string

		impa := strings.ToUpper(strings.TrimSpace(row.IMPACode))
		if impa != "" {
			id, err := h.repo.FindByIMPA(ctx, impa)
			if err == nil {
				itemID, confidence, source = id, 1.0, "IMPA_EXACT"
			} else if !errors.Is(err, ErrNotFound) {
				httperr.RenderDBErr(w, err)
				return
			}
		}

		if itemID == 0 && strings.TrimSpace(row.Name) != "" {
			matches, err := h.repo.MatchRequest(ctx, row.Name, 1)
			if err != nil {
				httperr.RenderDBErr(w, err)
				return
			}
			if len(matches) > 0 && matches[0].Confidence >= minScore {
				itemID, confidence, source = matches[0].ItemID, matches[0].Confidence, matches[0].Source
			}
		}

		// No catalog match: create a new product (empty price) when asked.
		if itemID == 0 && req.AutoCreate {
			name := strings.TrimSpace(row.Name)
			if name != "" {
				key := autoCreateKey(impa, name)
				if existing, ok := created[key]; ok {
					itemID, confidence, source = existing, 1.0, "CREATED"
				} else {
					var impaPtr *string
					if impa != "" {
						impaPtr = &impa
					}
					it, err := h.repo.Create(ctx, CreateItemRequest{Name: name, IMPACode: impaPtr}, userID)
					if err != nil {
						httperr.RenderDBErr(w, err)
						return
					}
					created[key] = it.ID
					itemID, confidence, source = it.ID, 1.0, "CREATED"
				}
			}
		}

		if itemID > 0 {
			m, err := h.repo.MatchWithVendorByID(ctx, itemID)
			if err == nil {
				res.Matched = &m
				res.Confidence = confidence
				res.Source = source
			} else if !errors.Is(err, ErrNotFound) {
				httperr.RenderDBErr(w, err)
				return
			}
		}
		out = append(out, res)
	}
	httpx.WriteJSON(w, http.StatusOK, MatchRowsResponse{Rows: out})
}

func (h *Handler) ListVendorsForItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	vendors, err := h.repo.ListVendorsForItem(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
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

	history, err := h.repo.SuggestSellingPrices(r.Context(), id, limit)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, history)
}
