package quotations

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/sheet"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// parseListFilter reads unpaged list filters.
func parseListFilter(r *http.Request) ListFilter {
	q := r.URL.Query()
	f := ListFilter{
		Q:       q.Get("q"),
		SortBy:  q.Get("sortBy"),
		SortDir: q.Get("sortDir"),
	}
	if s := q.Get("status"); s != "" {
		f.Statuses = strings.Split(s, ",")
	}
	if s := q.Get("dateFrom"); s != "" {
		f.DateFrom = &s
	}
	if s := q.Get("dateTo"); s != "" {
		f.DateTo = &s
	}
	if s := q.Get("minTotal"); s != "" {
		f.MinTotal = &s
	}
	if s := q.Get("maxTotal"); s != "" {
		f.MaxTotal = &s
	}
	return f
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = paginate.Parse(r)

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	w.Header().Set("X-Total-Count", strconv.FormatInt(res.Total, 10))
	httpx.WriteJSON(w, http.StatusOK, res.Rows)
}

// Export streams the filtered list.
// The list goes out as an XLSX table.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = listq.Unbounded, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "quotations.export", res.Total, len(res.Rows))
	headers := []string{"No. Quotation", "Tanggal", "Klien", "Status", "Subtotal", "Diskon", "Grand Total"}
	rows := make([][]string, 0, len(res.Rows))
	for _, q := range res.Rows {
		rows = append(rows, []string{
			q.QuotationNo,
			q.CreatedAt.In(tz.Jakarta()).Format("2006-01-02"),
			q.CompanyName,
			q.Status,
			q.Subtotal,
			q.TotalDiscount,
			q.GrandTotal,
		})
	}
	data, err := sheet.Write("Quotation", headers, rows)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteXLSX(w, "quotation-export", data)
}

func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.Stats(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	d, err := h.repo.GetDetail(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("quotation not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, d)
}

func (h *Handler) Revisions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	revs, err := h.repo.ListRevisions(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, revs)
}

// validateCreateStatus keeps create at draft.
//
// Every later state is reached through fn_change_quotation_status, which owns
// the transition table, the unpriced guard and PO creation. Returns nil when
// the payload is acceptable.
func validateCreateStatus(status *string) map[string]string {
	if status == nil || strings.TrimSpace(*status) == "" || strings.TrimSpace(*status) == "draft" {
		return nil
	}
	return map[string]string{
		"status": "quotation baru selalu berstatus draf; ubah status lewat endpoint status",
	}
}

// validateItemQty refuses quantityless lines.
func validateItemQty(items []CreateItem) map[string]string {
	for i, it := range items {
		qty, err := strconv.ParseFloat(strings.TrimSpace(it.Qty), 64)
		if err != nil || qty <= 0 {
			return map[string]string{
				"items[" + strconv.Itoa(i) + "].qty": "jumlah harus lebih besar dari 0",
			}
		}
	}
	return nil
}

// validateDiscountPct bounds the header discount.
// NaN and infinities fail the range test, and so does an empty value.
func validateDiscountPct(raw string) map[string]string {
	v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err == nil && v >= 0 && v <= 100 {
		return nil
	}
	return map[string]string{"discountPct": "Diskon harus berupa angka antara 0 dan 100."}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	// DB function does rest.
	if req.CompanyClientID == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"companyClientId": "required"}))
		return
	}
	if len(req.Items) == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"items": "at least 1 required"}))
		return
	}
	if fields := validateCreateStatus(req.Status); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if fields := validateDiscountPct(req.DiscountPct); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if fields := validateItemQty(req.Items); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	id, err := h.repo.Create(r.Context(), req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	ifMatch, err := httpx.ParseIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}
	if ifMatch == nil {
		httperr.Render(w, httperr.BadRequest("If-Match header required"))
		return
	}

	var req UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if len(req.Items) == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"items": "at least 1 required"}))
		return
	}
	if fields := validateDiscountPct(req.DiscountPct); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if fields := validateItemQty(req.Items); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	newVersion, err := h.repo.Update(r.Context(), id, req, userID, ifMatch)
	if err != nil {
		// 409 per round3_plan optimistic-lock contract (not RFC 7232 412).
		if errors.Is(err, ErrVersionMismatch) {
			httperr.Render(w, httperr.Conflict("quotation row_version mismatch"))
			return
		}
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("quotation not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":         id,
		"rowVersion": newVersion,
	})
}

func (h *Handler) ChangeStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req ChangeStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if fields := validateChangeStatus(req); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.ChangeStatus(r.Context(), id, req.Status, req.Note, userID); err != nil {
		renderStatusErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validateChangeStatus checks the body shape.
// The transition itself is judged by the database under its row lock.
func validateChangeStatus(req ChangeStatusRequest) map[string]string {
	if strings.TrimSpace(req.Status) == "" {
		return map[string]string{"status": "Status wajib diisi."}
	}
	if noteRequired(req.Status) && (req.Note == nil || strings.TrimSpace(*req.Note) == "") {
		return map[string]string{
			"note": "Alasan wajib diisi untuk status " + StatusLabel(req.Status) + ".",
		}
	}
	return nil
}

// renderStatusErr maps the unpriced guard.
// That guard is a 422; anything else is a DB error.
func renderStatusErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrUnpricedProducts) {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"items": "Semua baris produk harus memiliki harga jual sebelum quotation dikirim atau disetujui.",
		}))
		return
	}
	httperr.RenderDBErr(w, err)
}

// Revise clones a sent quotation.
// Answers 201 with the new draft id; the original moves to revision.
func (h *Handler) Revise(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req ReviseRequest
	// The note is optional, so an empty body is fine.
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	userID := deps.CurrentUserID(r.Context())
	newID, err := h.repo.Revise(r.Context(), id, req.Note, userID)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]int64{"id": newID})
}

func (h *Handler) ChangeContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req ChangeContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.ContactID == 0 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"contactId": "required"}))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateContact(r.Context(), id, req.ContactID, userID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("quotation not found"))
			return
		}
		if errors.Is(err, ErrContactNotAllowed) {
			httperr.Render(w, httperr.Unprocessable(map[string]string{
				"contactId": "contact not found or does not belong to this client",
			}))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Send moves status to sent.
// An optional note rides along.
func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	note := "Quotation dikirim ke klien"
	if r.Body != nil {
		var body struct {
			Note *string `json:"note,omitempty"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Note != nil && strings.TrimSpace(*body.Note) != "" {
			note = *body.Note
		}
	}
	userID := deps.CurrentUserID(r.Context())
	if err := h.repo.ChangeStatus(r.Context(), id, "sent", &note, userID); err != nil {
		renderStatusErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
