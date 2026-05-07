package items

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

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
	items, err := h.repo.List(r.Context(), limit, offset)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, items)
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
		httperr.Render(w, httperr.Internal(err.Error()))
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
		httperr.Render(w, httperr.Internal(err.Error()))
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
		httperr.Render(w, httperr.Internal(err.Error()))
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
		httperr.Render(w, httperr.BadRequest(err.Error()))
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
	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}

	results, err := h.repo.Search(r.Context(), q, minScore, limit)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, results)
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
		httperr.Render(w, httperr.Internal(err.Error()))
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
	minScore := req.MinScore
	if minScore <= 0 {
		minScore = 0.5
	}

	ctx := r.Context()
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
				httperr.Render(w, httperr.Internal(err.Error()))
				return
			}
		}

		if itemID == 0 && strings.TrimSpace(row.Name) != "" {
			matches, err := h.repo.MatchRequest(ctx, row.Name, 1)
			if err != nil {
				httperr.Render(w, httperr.Internal(err.Error()))
				return
			}
			if len(matches) > 0 && matches[0].Confidence >= minScore {
				itemID, confidence, source = matches[0].ItemID, matches[0].Confidence, matches[0].Source
			}
		}

		if itemID > 0 {
			m, err := h.repo.MatchWithVendorByID(ctx, itemID)
			if err == nil {
				res.Matched = &m
				res.Confidence = confidence
				res.Source = source
			} else if !errors.Is(err, ErrNotFound) {
				httperr.Render(w, httperr.Internal(err.Error()))
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
		httperr.Render(w, httperr.Internal(err.Error()))
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
	limit := 5
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}

	history, err := h.repo.SuggestSellingPrices(r.Context(), id, limit)
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, history)
}
