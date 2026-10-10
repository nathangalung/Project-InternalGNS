package purchaseorders

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/sheet"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

type Handler struct {
	repo *Repo
	// objects may be nil.
	// Nil means storage is not configured.
	objects deps.ObjectStore
}

func NewHandler(repo *Repo, objects deps.ObjectStore) *Handler {
	return &Handler{repo: repo, objects: objects}
}

// parseListFilter reads unpaged list filters.
func parseListFilter(r *http.Request) ListFilter {
	q := r.URL.Query()
	f := ListFilter{
		Q:       strings.TrimSpace(q.Get("q")),
		SortBy:  q.Get("sortBy"),
		SortDir: q.Get("sortDir"),
	}
	if s := strings.TrimSpace(q.Get("status")); s != "" {
		for _, raw := range strings.Split(s, ",") {
			if v := strings.TrimSpace(raw); v != "" {
				f.Statuses = append(f.Statuses, v)
			}
		}
	}
	f.DateFrom = httpx.ParseDateParam(q.Get("dateFrom"))
	f.DateTo = httpx.ParseDateParam(q.Get("dateTo"))
	if s := strings.TrimSpace(q.Get("minTotal")); s != "" {
		f.MinTotal = &s
	}
	if s := strings.TrimSpace(q.Get("maxTotal")); s != "" {
		f.MaxTotal = &s
	}
	return f
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	role := deps.CurrentUserRole(r.Context())
	f := parseListFilter(r)
	if !roles.SeesSelling(role) && f.probesSelling() {
		rolegate.Refused(w)
		return
	}
	f.Limit, f.Offset = paginate.Parse(r)

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	for i := range res.Rows {
		res.Rows[i].redact(role)
	}
	w.Header().Set("X-Total-Count", strconv.FormatInt(res.Total, 10))
	httpx.WriteJSON(w, http.StatusOK, res.Rows)
}

// Export streams the filtered list.
// The XLSX carries delivery-note numbers. The note's own date and the
// client's PO date are separate columns, each named for what it is.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	f := parseListFilter(r)
	f.Limit, f.Offset = listq.Unbounded, 0

	res, err := h.repo.List(r.Context(), f)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WarnIfTruncated(r.Context(), "purchaseorders.export", res.Total, len(res.Rows))
	headers := []string{
		"No. Delivery Note", "Tanggal Delivery Note", "No. PO", "Tanggal PO",
		"No. Quotation", "Klien", "Status", "Total",
	}
	rows := make([][]string, 0, len(res.Rows))
	for _, po := range res.Rows {
		// Same rule as the PDF: blank unless the note can be printed.
		dn, issued := issuedDeliveryNote(po)
		dnDate := ""
		if issued {
			dnDate = deliveryNoteDate(po).In(tz.Jakarta()).Format("2006-01-02")
		}
		rows = append(rows, []string{
			dn,
			dnDate,
			pdfgen.StrDeref(po.PoNumber),
			po.PoDate.In(tz.Jakarta()).Format("2006-01-02"),
			po.QuotationNo,
			po.CompanyName,
			StatusLabel(po.Status),
			po.PoGrandTotal,
		})
	}
	data, err := sheet.Write("Delivery Note", headers, rows, 7)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteXLSX(w, "delivery-note-export", data)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	po, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("purchase order not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	po.redact(deps.CurrentUserRole(r.Context()))
	httpx.WriteJSON(w, http.StatusOK, po)
}

func (h *Handler) GetByQuotation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "quotationId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid quotation id"))
		return
	}
	po, err := h.repo.GetByQuotation(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("purchase order not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	po.redact(deps.CurrentUserRole(r.Context()))
	httpx.WriteJSON(w, http.StatusOK, po)
}

func (h *Handler) ListItems(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	for i := range items {
		items[i].redact(deps.CurrentUserRole(r.Context()))
	}
	httpx.WriteJSON(w, http.StatusOK, items)
}

func (h *Handler) UpdateFile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req UpdateFileRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.FileName = strings.TrimSpace(req.FileName)
	req.ObjectKey = strings.TrimSpace(req.ObjectKey)
	if fields := validateFile(req); len(fields) > 0 {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	// Owner first, so a missing PO reads as 404.
	if _, err := h.repo.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("purchase order not found"))
			return
		}
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	// The key comes from the client, so it must address an upload made for
	// this PO rather than any object in the bucket or a traversal path.
	if err := storage.ValidateOwnedKey(storage.BucketPODocs, "po", id, req.ObjectKey); err != nil {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"objectKey": "Berkas tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.",
		}))
		return
	}
	if !h.fileUploaded(w, r, req.ObjectKey) {
		return
	}

	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateFile(r.Context(), id, req, actor); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrLocked):
			renderLocked(w, err.Error())
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// fileUploaded confirms the upload arrived.
// A valid key only says where an upload would land; attaching moves the PO
// to UPLOADED, so it must never point at a file that never arrived.
func (h *Handler) fileUploaded(w http.ResponseWriter, r *http.Request, key string) bool {
	if h.objects == nil {
		httperr.Render(w, httperr.ServiceUnavailable("Berkas belum bisa disimpan saat ini. Hubungi administrator."))
		return false
	}
	ok, err := h.objects.ObjectExists(r.Context(), storage.BucketPODocs, key)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, fmt.Errorf("po file stat: %w", err))
		return false
	}
	if !ok {
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"objectKey": "Berkas PO belum terunggah. Unggah ulang berkasnya lalu simpan kembali.",
		}))
		return false
	}
	return true
}

func (h *Handler) UpdateNotes(w http.ResponseWriter, r *http.Request) {
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
	var req UpdateNotesRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdateNotes(r.Context(), id, req.Notes, actor, ifMatch); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrVersionMismatch):
			httperr.Render(w, httperr.VersionConflict())
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateDetails(w http.ResponseWriter, r *http.Request) {
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
	var req UpdateDetailsRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	poDate, err := time.Parse("2006-01-02", strings.TrimSpace(req.PoDate))
	if err != nil {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"poDate": "Tanggal PO tidak valid. Pilih tanggal dari kalender."}))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	// A blank number means none; the database refuses it once work started.
	if err := h.repo.UpdateDetails(r.Context(), id, strings.TrimSpace(req.PoNumber), poDate, actor, ifMatch); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrDuplicatePoNumber):
			httperr.Render(w, httperr.Unprocessable(map[string]string{
				"poNumber": "sudah dipakai PO lain untuk klien ini",
			}))
		case errors.Is(err, ErrPoNumberRequired):
			httperr.Render(w, httperr.Unprocessable(map[string]string{"poNumber": err.Error()}))
		case errors.Is(err, ErrVersionMismatch):
			httperr.Render(w, httperr.VersionConflict())
		// A filed invoice prints po_number and po_date, so both are read-only.
		case errors.Is(err, ErrLocked):
			renderLocked(w, "Nomor dan tanggal PO tidak dapat diubah setelah invoice dikirim.")
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ChangeStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	var req ChangeStatusRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if !isValidStatus(req.Status) {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"status": "Status PO tidak dikenal."}))
		return
	}
	if !canMove(deps.CurrentUserRole(r.Context()), req.Status) {
		rolegate.Refused(w)
		return
	}
	req.Note = strings.TrimSpace(req.Note)
	if requiresNote(req.Status) && req.Note == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"note": "Alasan pembatalan wajib diisi."}))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	issues, err := h.repo.GatedTransition(r.Context(), id, req.Status, req.Note, actor)
	if len(issues) > 0 {
		p := incompleteProblem(issues)
		httperr.RenderAs(w, p.Status, p)
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		// The DB prose says why, e.g. the status follows the file.
		case errors.Is(err, ErrInvalidTransition):
			httperr.Render(w, httperr.Unprocessable(map[string]string{"status": err.Error()}))
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateItems(w http.ResponseWriter, r *http.Request) {
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
	var req UpdateItemsRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if !roles.SetsPrices(deps.CurrentUserRole(r.Context())) {
		if err := h.repo.keepStoredSale(r.Context(), id, &req); err != nil {
			switch {
			case errors.Is(err, errLinesChanged):
				httperr.Render(w, httperr.Forbidden(msgLinesChanged))
			case errors.Is(err, ErrNotFound):
				httperr.Render(w, httperr.NotFound("purchase order not found"))
			default:
				httperr.RenderDBErrCtx(r.Context(), w, err)
			}
			return
		}
	}
	if strings.TrimSpace(req.DiscountPct) == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"discountPct": "required"}))
		return
	}
	if fields := validateItemNumbers(req); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	newVersion, err := h.repo.UpdateItems(r.Context(), id, req, actor, ifMatch)
	if err != nil {
		switch {
		// 409 per round3_plan optimistic-lock contract (not RFC 7232 412).
		case errors.Is(err, ErrVersionMismatch):
			httperr.Render(w, httperr.VersionConflict())
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrLocked):
			renderLocked(w, err.Error())
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, UpdatedResponse{ID: id, RowVersion: newVersion})
}

// gatedMove names the gated moves.
// Starting work and delivering both need complete master data: edits in
// ON_PROGRESS and client edits can reopen a gap after the promotion passed.
// The database refuses every other move into these states. The move judges
// from the status it locked, never from an earlier read.
func gatedMove(from, to Status) bool {
	return (from == StatusUploaded && to == StatusOnProgress) ||
		(from == StatusOnProgress && to == StatusDelivered)
}

// RemoveFile detaches the PO document.
func (h *Handler) RemoveFile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.RemoveFile(r.Context(), id, actor); err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Render(w, httperr.NotFound("purchase order not found"))
		case errors.Is(err, ErrLocked):
			renderLocked(w, err.Error())
		default:
			httperr.RenderDBErrCtx(r.Context(), w, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// History returns the status timeline.
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	rows, err := h.repo.History(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("purchase order not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// LockedCode tags lock refusals.
// The web branches on it: an If-Match mismatch carries
// httperr.VersionConflictCode instead, which a refetch resolves, while a
// lock needs no retry.
const LockedCode = "po_locked"

// renderLocked writes lock refusals.
func renderLocked(w http.ResponseWriter, detail string) {
	e := httperr.Conflict(detail)
	e.Code = LockedCode
	httperr.Render(w, e)
}

// validateFile checks the attach payload.
// The key is bound to its PO later, once the PO is known to exist.
func validateFile(req UpdateFileRequest) map[string]string {
	fields := map[string]string{}
	switch {
	case req.FileName == "":
		fields["fileName"] = "Nama berkas wajib diisi."
	case storage.ValidateAssetFileName(storage.BucketPODocs, req.FileName) != nil:
		fields["fileName"] = "Jenis berkas tidak didukung. Gunakan PDF, PNG, JPG, WEBP, XLS, atau XLSX."
	}
	if limit := storage.MaxBytes(storage.BucketPODocs); req.FileSize < 1 || req.FileSize > limit {
		fields["fileSize"] = fmt.Sprintf("Berkas kosong atau lebih dari %d MB.", limit>>20)
	}
	if req.ObjectKey == "" {
		fields["objectKey"] = "Berkas PO wajib diunggah."
	}
	return fields
}

// validateItemNumbers checks edit numbers.
// A qty 0 line stays allowed and a blank value keeps the database default;
// a sent harga jual must be above zero, as fn_update_po_items demands.
// NaN passes every >= 0 test in Postgres, so it is refused here.
func validateItemNumbers(req UpdateItemsRequest) map[string]string {
	f := validate.Fields{}
	given := func(s string) bool { return strings.TrimSpace(s) != "" }
	for i, it := range req.Items {
		key := "items[" + strconv.Itoa(i) + "]."
		if given(it.Qty) {
			f.Add(key+"qty", validate.NonNegative("Jumlah", it.Qty))
		}
		if given(it.SellingPrice) {
			f.Add(key+"sellingPrice", validate.Positive("Harga jual", it.SellingPrice))
		}
		if it.CostPrice != nil && given(*it.CostPrice) {
			f.Add(key+"costPrice", validate.NonNegative("Harga beli", *it.CostPrice))
		}
	}
	if req.ShippingDays != nil {
		f.Add("shippingDays", validate.Days("Waktu pengiriman", *req.ShippingDays))
	}
	if req.ShippingCost != nil {
		f.Add("shippingCost", validate.NonNegative("Biaya pengiriman", *req.ShippingCost))
	}
	return f.Result()
}
