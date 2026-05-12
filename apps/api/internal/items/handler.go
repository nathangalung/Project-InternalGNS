package items

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
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
	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}

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
	limit := 20
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}

	ctx := r.Context()
	perTier := limit * 2

	items, err := h.repo.Search(ctx, q, minScore, perTier)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	offers, err := h.repo.SearchVendorOffers(ctx, q, perTier)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	requests, err := h.repo.SearchRequestHistory(ctx, q, perTier)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	resp := mergeAdvanced(q, items, offers, requests, limit)
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// tierWeight ranks tiers; higher = better.
func tierWeight(tier string) float32 {
	switch tier {
	case "ITEM_AUTO":
		return 5.0
	case "VENDOR_OFFER":
		return 4.0
	case "ITEM_SUGGESTED":
		return 3.0
	case "REQUEST_HISTORY":
		return 2.0
	case "ITEM_FUZZY":
		return 1.0
	default:
		return 0
	}
}

// classify maps item match_tier→canonical advanced tier.
func classifyItem(t string) string {
	switch t {
	case "AUTO_MATCH":
		return "ITEM_AUTO"
	case "SUGGESTED":
		return "ITEM_SUGGESTED"
	default:
		return "ITEM_FUZZY"
	}
}

func mergeAdvanced(q string, items []SearchResult, offers []VendorOfferHit, requests []RequestHistoryHit, limit int) AdvancedSearchResponse {
	hits := map[int64]*AdvancedSearchHit{}
	counts := map[string]int{}

	upsert := func(id int64, tier string, score float32, enrich func(*AdvancedSearchHit)) {
		h, ok := hits[id]
		if !ok {
			h = &AdvancedSearchHit{ID: id, Score: score, Tier: tier, Tiers: []string{tier}}
			hits[id] = h
		} else {
			if !contains(h.Tiers, tier) {
				h.Tiers = append(h.Tiers, tier)
			}
			if tierWeight(tier) > tierWeight(h.Tier) ||
				(tierWeight(tier) == tierWeight(h.Tier) && score > h.Score) {
				h.Tier = tier
				h.Score = score
			}
		}
		counts[tier]++
		if enrich != nil {
			enrich(h)
		}
	}

	for _, it := range items {
		tier := classifyItem(it.MatchTier)
		upsert(it.ID, tier, it.Score, func(h *AdvancedSearchHit) {
			if h.Name == "" {
				h.Name = it.Name
				h.IMPACode = it.IMPACode
				h.DefaultUnitID = it.DefaultUnitID
			}
		})
	}
	for _, o := range offers {
		vid := o.VendorID
		vname := o.VendorName
		sku := o.VendorSKU
		upsert(o.ItemID, "VENDOR_OFFER", o.Score, func(h *AdvancedSearchHit) {
			if h.VendorID == nil {
				h.VendorID = &vid
				h.VendorName = &vname
				h.VendorSKU = sku
			}
		})
	}
	for _, rq := range requests {
		txt := rq.RequestText
		upsert(rq.ItemID, "REQUEST_HISTORY", rq.Score, func(h *AdvancedSearchHit) {
			if h.RequestText == nil {
				h.RequestText = &txt
			}
		})
	}

	out := make([]AdvancedSearchHit, 0, len(hits))
	for _, h := range hits {
		out = append(out, *h)
	}
	sort.SliceStable(out, func(i, j int) bool {
		wi, wj := tierWeight(out[i].Tier), tierWeight(out[j].Tier)
		if wi != wj {
			return wi > wj
		}
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > limit {
		out = out[:limit]
	}

	return AdvancedSearchResponse{
		Query:  q,
		Total:  len(out),
		Hits:   out,
		Counts: counts,
	}
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
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
	limit := 5
	if s := r.URL.Query().Get("limit"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			limit = v
		}
	}

	history, err := h.repo.SuggestSellingPrices(r.Context(), id, limit)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, history)
}
