package users

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

// Handler exposes user endpoints.
type Handler struct {
	repo *Repo
}

// NewHandler builds the handler.
func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// List returns paged users with X-Total-Count header.
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
	if v := strings.TrimSpace(q.Get("role")); v != "" {
		f.Role = &v
	}
	if s := q.Get("isActive"); s != "" {
		if v, err := strconv.ParseBool(s); err == nil {
			f.IsActive = &v
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

// Get one user by id.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	u, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("user not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, u)
}

// Create makes a new user.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}

	if err := validateCreate(req); err != nil {
		httperr.Render(w, httperr.Unprocessable(err))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	u, err := h.repo.Create(r.Context(), req, actor)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, u)
}

// Update edits one user.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}

	if err := validateUpdate(req); err != nil {
		httperr.Render(w, httperr.Unprocessable(err))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	u, err := h.repo.Update(r.Context(), id, req, actor)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("user not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, u)
}

// ChangePassword resets the password.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if len(req.Password) < 8 {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"password": "min 8 chars"}))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdatePassword(r.Context(), id, req.Password, actor); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("user not found"))
			return
		}
		httperr.RenderDBErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validateCreate enforces required fields.
func validateCreate(req CreateUserRequest) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(req.Email) == "" {
		errs["email"] = "required"
	}
	if strings.TrimSpace(req.Name) == "" {
		errs["name"] = "required"
	}
	if len(req.Password) < 8 {
		errs["password"] = "min 8 chars"
	}
	if !isValidRole(req.Role) {
		errs["role"] = "invalid role"
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// validateUpdate enforces required fields.
func validateUpdate(req UpdateUserRequest) map[string]string {
	errs := map[string]string{}
	if strings.TrimSpace(req.Email) == "" {
		errs["email"] = "required"
	}
	if strings.TrimSpace(req.Name) == "" {
		errs["name"] = "required"
	}
	if !isValidRole(req.Role) {
		errs["role"] = "invalid role"
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// isValidRole checks role enum.
func isValidRole(r Role) bool {
	switch r {
	case RoleSuperadmin, RoleOperational, RoleFinance:
		return true
	default:
		return false
	}
}
