package users

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/paginate"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
)

// Handler exposes user endpoints.
type Handler struct {
	repo    *Repo
	cookies session.Cookies
}

// NewHandler builds the handler.
// cookies expires the caller's refresh cookie when an edit ends their own
// session.
func NewHandler(repo *Repo, cookies session.Cookies) *Handler {
	return &Handler{repo: repo, cookies: cookies}
}

// List pages users with X-Total-Count.
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
		httperr.RenderDBErrCtx(r.Context(), w, err)
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

	// Admin read: an inactive account must stay visible or nobody can
	// reactivate it.
	u, err := h.repo.GetByIDAdmin(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("user not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, u)
}

// Create makes a new user.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateUserRequest
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	if err := validateCreate(req); err != nil {
		httperr.Render(w, httperr.Unprocessable(err))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	u, err := h.repo.Create(r.Context(), req, actor)
	if errors.Is(err, ErrEmailTaken) {
		httperr.Render(w, httperr.Conflict(emailTakenMessage))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
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
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}

	stored := func() (string, error) {
		u, err := h.repo.GetByIDAdmin(r.Context(), id)
		return u.Email, err
	}
	if err := validateUpdate(req, stored); err != nil {
		httperr.Render(w, httperr.Unprocessable(err))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	u, err := h.repo.Update(r.Context(), id, req, actor)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("user not found"))
		return
	}
	if errors.Is(err, ErrEmailTaken) {
		httperr.Render(w, httperr.Conflict(emailTakenMessage))
		return
	}
	if errors.Is(err, ErrLastSuperadmin) {
		httperr.Render(w, httperr.Conflict(lastSuperadminMessage))
		return
	}
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	// The caller's live role is in the context, so a changed role or a
	// deactivation here means the repo just ended the caller's own sessions.
	if actor == id && (string(u.Role) != deps.CurrentUserRole(r.Context()) || !u.IsActive) {
		h.cookies.Clear(w, r)
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
	if !httpx.DecodeJSON(w, r, &req) {
		return
	}
	if msg := ValidatePassword(req.Password); msg != "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"password": msg}))
		return
	}

	actor := deps.CurrentUserID(r.Context())
	if err := h.repo.UpdatePassword(r.Context(), id, req.Password, actor); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Render(w, httperr.NotFound("user not found"))
			return
		}
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}
	// A reset ends every session of the account, the caller's own included.
	if actor == id {
		h.cookies.Clear(w, r)
	}
	w.WriteHeader(http.StatusNoContent)
}
