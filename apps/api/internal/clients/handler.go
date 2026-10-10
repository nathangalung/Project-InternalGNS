package clients

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/rolegate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

type Handler struct {
	repo *Repo
}

func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// List handles GET /clients.
// It applies filters, sort and pagination.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if key := badQueryParam(q); key != "" {
		httperr.Render(w, httperr.BadRequest("invalid text in query parameter "+key))
		return
	}
	limit, offset := paginate.Parse(r)

	f := ListFilter{
		Q:           q.Get("q"),
		CountryCode: q.Get("countryCode"),
		SortBy:      q.Get("sortBy"),
		SortDir:     q.Get("sortDir"),
		Limit:       limit,
		Offset:      offset,
	}
	if s := q.Get("isActive"); s != "" {
		switch s {
		case "true", "1":
			v := true
			f.IsActive = &v
		case "false", "0":
			v := false
			f.IsActive = &v
		}
	}
	if s := q.Get("minTotal"); s != "" {
		f.MinTotal = &s
	}
	role := deps.CurrentUserRole(r.Context())
	if !roles.SeesSelling(role) && f.probesSelling() {
		rolegate.Refused(w)
		return
	}

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

// Get handles GET /clients/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	c, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	c.redact(deps.CurrentUserRole(r.Context()))
	httpx.WriteJSON(w, http.StatusOK, c)
}

// Create handles POST /clients
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateClientRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}
	trimText(req.Email)
	if fields := contactFields(nil, req.Email); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if msg := validate.ClientNPWP(req.CountryCode, req.NPWP); msg != "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"npwp": msg}))
		return
	}
	req.NPWP = validate.StoredNPWP(req.CountryCode, req.NPWP)
	number, ok := normalizeNumber(req.Number)
	if !ok {
		numberProblem(w, ErrNumberInvalid)
		return
	}
	req.Number = number

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Create(r.Context(), req, userID)
	if numberProblem(w, err) {
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	c.redact(deps.CurrentUserRole(r.Context()))
	httpx.WriteJSON(w, http.StatusCreated, c)
}

// Update handles PUT /clients/{id}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req UpdateClientRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}
	trimText(req.Email)
	if fields := contactFields(nil, req.Email); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	country, ok := h.updateCountry(w, r, id, req)
	if !ok {
		return
	}
	if msg := validate.ClientNPWP(country, req.NPWP); msg != "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"npwp": msg}))
		return
	}
	req.NPWP = validate.StoredNPWP(country, req.NPWP)

	number, ok := normalizeNumber(req.Number)
	if !ok {
		numberProblem(w, ErrNumberInvalid)
		return
	}
	req.Number = number

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.Update(r.Context(), id, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	}
	if numberProblem(w, err) {
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	c.redact(deps.CurrentUserRole(r.Context()))
	httpx.WriteJSON(w, http.StatusOK, c)
}

// updateCountry is the country saved.
// clients.update keeps the stored country when the body sends none, so the
// NPWP is judged against that one; ok is false once a problem is written.
func (h *Handler) updateCountry(w http.ResponseWriter, r *http.Request, id int64, req UpdateClientRequest) (string, bool) {
	if req.CountryCode != "" || req.NPWP == nil || strings.TrimSpace(*req.NPWP) == "" {
		return req.CountryCode, true
	}
	stored, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return "", false
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return "", false
	}
	return stored.CountryCode, true
}

// Summary handles GET /clients/summary
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.Summary(r.Context())
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

// Search handles GET /clients/search?q=&minScore=&limit=
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
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

	limit := paginate.ParseLimit(r, 10)

	results, err := h.repo.Search(r.Context(), q, minScore, limit)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, results)
}

// ListContacts handles GET /clients/{id}/contacts
func (h *Handler) ListContacts(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	if err := h.requireClient(r.Context(), id); err != nil {
		renderClientErr(w, r, err)
		return
	}
	contacts, err := h.repo.ListContacts(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, contacts)
}

// CreateContact handles POST /clients/{id}/contacts
func (h *Handler) CreateContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req CreateContactRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}
	trimText(req.Email)
	if fields := contactFields(req.Phone, req.Email); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	if !reachable(req.Email, req.Phone) {
		// A missing client is a 404 before the reach rule.
		if err := h.requireClient(r.Context(), id); err != nil {
			renderClientErr(w, r, err)
			return
		}
		httperr.Render(w, httperr.Unprocessable(needReach()))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.CreateContact(r.Context(), id, req, userID)
	if err != nil {
		renderContactErr(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, c)
}

// UpdateContact edits a contact.
// It serves PATCH /clients/{id}/contacts/{cid}.
func (h *Handler) UpdateContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	cid, err := strconv.ParseInt(chi.URLParam(r, "contactId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid contact id"))
		return
	}

	var req UpdateContactRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
		return
	}
	trimText(req.Email.Value)
	// An absent email key is kept, so only a sent one is checked.
	if fields := contactFields(req.Phone, req.Email.Value); fields != nil {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}
	// A missing or deleted contact is a 404 before the reach rule, and an
	// absent email keeps the stored one, which still reaches the contact.
	stored, err := h.repo.GetContact(r.Context(), id, cid)
	if errors.Is(err, ErrNotFound) || (err == nil && !stored.IsActive) {
		httperr.Render(w, httperr.NotFound("contact not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	email := stored.Email
	if req.Email.Set {
		email = req.Email.Value
	}
	if !reachable(email, req.Phone) {
		httperr.Render(w, httperr.Unprocessable(needReach()))
		return
	}

	userID := deps.CurrentUserID(r.Context())
	c, err := h.repo.UpdateContact(r.Context(), id, cid, req, userID)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("contact not found"))
		return
	}
	if err != nil {
		renderContactErr(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, c)
}

// DeleteContact soft-deletes a contact.
func (h *Handler) DeleteContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	cid, err := strconv.ParseInt(chi.URLParam(r, "contactId"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid contact id"))
		return
	}
	if err := h.repo.DeactivateContact(r.Context(), id, cid, deps.CurrentUserID(r.Context())); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("contact not found"))
			return
		}
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Delete removes an unused client.
// It serves DELETE /clients/{id}. A client a document uses is a 409
// in_use naming where, and the logo object is left to cmd/orphan-blobs.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	name, usage, err := h.repo.Delete(r.Context(), id)
	switch {
	case errors.Is(err, ErrNotFound):
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	case errors.Is(err, ErrInUse):
		httperr.Render(w, httperr.InUse("Klien ini", usage.Uses()))
		return
	case err != nil:
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	// The row is gone, so the log keeps who and what.
	slog.InfoContext(r.Context(), "permanent delete", "user_id", deps.CurrentUserID(r.Context()),
		"entity", "client", "id", id, "name", name)
	w.WriteHeader(http.StatusNoContent)
}

// requireClient checks the parent exists.
// It runs before a sub-collection read.
func (h *Handler) requireClient(ctx context.Context, id int64) error {
	_, err := h.repo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("load client %d: %w", id, err)
	}
	return nil
}

// msgEmailTaken sits on email.
// The unique index is per client, so the owner is another contact of it.
const msgEmailTaken = "Email ini sudah dipakai narahubung lain di klien ini."

// renderContactErr maps save failures.
func renderContactErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrEmailTaken) {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"email": msgEmailTaken}))
		return
	}
	httperr.RenderDBErrCtx(r.Context(), w, err)
}

// renderClientErr maps sentinels to problems.
func renderClientErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("client not found"))
		return
	}
	httperr.RenderDBErrCtx(r.Context(), w, err)
}

// RecentQuotations lists the client's newest quotations.
// GET /clients/{id}/quotations; the newest RecentQuotationCount.
func (h *Handler) RecentQuotations(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}
	if err := h.requireClient(r.Context(), id); err != nil {
		renderClientErr(w, r, err)
		return
	}
	rows, err := h.repo.RecentQuotations(r.Context(), id)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	for i := range rows {
		rows[i].redact(deps.CurrentUserRole(r.Context()))
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}
