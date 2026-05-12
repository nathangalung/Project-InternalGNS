package quotations

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// One pre-quotation request line.
type ItemRequestRow struct {
	ID            int64      `db:"id"               json:"id"`
	QuotationID   int64      `db:"quotation_id"     json:"quotationId"`
	LineNo        int32      `db:"line_no"          json:"lineNo"`
	RequestText   string     `db:"request_text"     json:"requestText"`
	RequestImpa   *string    `db:"request_impa"     json:"requestImpa,omitempty"`
	RequestedQty  *string    `db:"requested_qty"    json:"requestedQty,omitempty"`
	RequestedUom  *string    `db:"requested_uom"    json:"requestedUom,omitempty"`
	MatchedItemID *int64     `db:"matched_item_id"  json:"matchedItemId,omitempty"`
	MatchStatus   string     `db:"match_status"     json:"matchStatus"`
	SourceType    string     `db:"source_type"      json:"sourceType"`
	SourceRef     *string    `db:"source_ref"       json:"sourceRef,omitempty"`
	Notes         *string    `db:"notes"            json:"notes,omitempty"`
	ReviewedBy    *int64     `db:"reviewed_by"      json:"reviewedBy,omitempty"`
	ReviewedAt    *time.Time `db:"reviewed_at"      json:"reviewedAt,omitempty"`
	RowVersion    int32      `db:"row_version"      json:"rowVersion"`
	CreatedBy     int64      `db:"created_by"       json:"createdBy"`
	UpdatedBy     *int64     `db:"updated_by"       json:"updatedBy,omitempty"`
	CreatedAt     time.Time  `db:"created_at"       json:"createdAt"`
	UpdatedAt     time.Time  `db:"updated_at"       json:"updatedAt"`
}

// Create request body.
type ItemRequestCreate struct {
	LineNo        int32   `json:"lineNo"`
	RequestText   string  `json:"requestText"`
	RequestImpa   *string `json:"requestImpa,omitempty"`
	RequestedQty  *string `json:"requestedQty,omitempty"`
	RequestedUom  *string `json:"requestedUom,omitempty"`
	MatchedItemID *int64  `json:"matchedItemId,omitempty"`
	MatchStatus   *string `json:"matchStatus,omitempty"`
	SourceType    *string `json:"sourceType,omitempty"`
	SourceRef     *string `json:"sourceRef,omitempty"`
	Notes         *string `json:"notes,omitempty"`
}

// Update request body (full replace).
type ItemRequestUpdate struct {
	LineNo        int32   `json:"lineNo"`
	RequestText   string  `json:"requestText"`
	RequestImpa   *string `json:"requestImpa,omitempty"`
	RequestedQty  *string `json:"requestedQty,omitempty"`
	RequestedUom  *string `json:"requestedUom,omitempty"`
	MatchedItemID *int64  `json:"matchedItemId,omitempty"`
	MatchStatus   string  `json:"matchStatus"`
	SourceType    string  `json:"sourceType"`
	SourceRef     *string `json:"sourceRef,omitempty"`
	Notes         *string `json:"notes,omitempty"`
}

// ListItemRequests returns rows for quotation.
func (r *Repo) ListItemRequests(ctx context.Context, quotationID int64) ([]ItemRequestRow, error) {
	rows, err := r.db.Query(ctx, r.store.Get("quotations.qir_list"), quotationID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[ItemRequestRow])
	if out == nil {
		out = []ItemRequestRow{}
	}
	return out, err
}

// GetItemRequest by id.
func (r *Repo) GetItemRequest(ctx context.Context, id int64) (ItemRequestRow, error) {
	var row ItemRequestRow
	rows, err := r.db.Query(ctx, r.store.Get("quotations.qir_get"), id)
	if err != nil {
		return row, err
	}
	row, err = pgx.CollectOneRow(rows, pgx.RowToStructByName[ItemRequestRow])
	if errors.Is(err, pgx.ErrNoRows) {
		return row, ErrNotFound
	}
	return row, err
}

// CreateItemRequest inserts new row.
func (r *Repo) CreateItemRequest(ctx context.Context, quotationID int64, req ItemRequestCreate, userID int64) (ItemRequestRow, error) {
	var row ItemRequestRow
	rows, err := r.db.Query(ctx, r.store.Get("quotations.qir_create"),
		quotationID, req.LineNo, req.RequestText, req.RequestImpa,
		req.RequestedQty, req.RequestedUom,
		req.MatchedItemID, req.MatchStatus, req.SourceType,
		req.SourceRef, req.Notes, userID,
	)
	if err != nil {
		return row, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[ItemRequestRow])
}

// UpdateItemRequest full replace + bump version.
// Sets reviewed_by/at on first pending→non-pending only.
func (r *Repo) UpdateItemRequest(ctx context.Context, id int64, req ItemRequestUpdate, userID int64) (ItemRequestRow, error) {
	var row ItemRequestRow
	rows, err := r.db.Query(ctx, r.store.Get("quotations.qir_update"),
		id, req.LineNo, req.RequestText, req.RequestImpa,
		req.RequestedQty, req.RequestedUom,
		req.MatchedItemID, req.MatchStatus, req.SourceType,
		req.SourceRef, req.Notes, userID,
	)
	if err != nil {
		return row, err
	}
	row, err = pgx.CollectOneRow(rows, pgx.RowToStructByName[ItemRequestRow])
	if errors.Is(err, pgx.ErrNoRows) {
		return row, ErrNotFound
	}
	return row, err
}

// DeleteItemRequest removes row.
func (r *Repo) DeleteItemRequest(ctx context.Context, id int64) error {
	var deleted int64
	err := r.db.QueryRow(ctx, r.store.Get("quotations.qir_delete"), id).Scan(&deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (h *Handler) ListItemRequests(w http.ResponseWriter, r *http.Request) {
	qid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	out, err := h.repo.ListItemRequests(r.Context(), qid)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) CreateItemRequest(w http.ResponseWriter, r *http.Request) {
	qid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req ItemRequestCreate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if errs := validateCreateQIR(req); len(errs) > 0 {
		httperr.Render(w, httperr.Unprocessable(errs))
		return
	}
	userID := deps.CurrentUserID(r.Context())
	out, err := h.repo.CreateItemRequest(r.Context(), qid, req, userID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, out)
}

func (h *Handler) UpdateItemRequest(w http.ResponseWriter, r *http.Request) {
	rid, err := strconv.ParseInt(chi.URLParam(r, "rid"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid rid"))
		return
	}
	var req ItemRequestUpdate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if errs := validateUpdateQIR(req); len(errs) > 0 {
		httperr.Render(w, httperr.Unprocessable(errs))
		return
	}
	userID := deps.CurrentUserID(r.Context())
	out, err := h.repo.UpdateItemRequest(r.Context(), rid, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("request not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) DeleteItemRequest(w http.ResponseWriter, r *http.Request) {
	rid, err := strconv.ParseInt(chi.URLParam(r, "rid"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid rid"))
		return
	}
	err = h.repo.DeleteItemRequest(r.Context(), rid)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("request not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validateCreateQIR(req ItemRequestCreate) map[string]string {
	errs := map[string]string{}
	if req.LineNo <= 0 {
		errs["lineNo"] = "must be > 0"
	}
	if req.RequestText == "" {
		errs["requestText"] = "required"
	}
	return errs
}

func validateUpdateQIR(req ItemRequestUpdate) map[string]string {
	errs := map[string]string{}
	if req.LineNo <= 0 {
		errs["lineNo"] = "must be > 0"
	}
	if req.RequestText == "" {
		errs["requestText"] = "required"
	}
	if req.MatchStatus == "" {
		errs["matchStatus"] = "required"
	}
	if req.SourceType == "" {
		errs["sourceType"] = "required"
	}
	return errs
}
