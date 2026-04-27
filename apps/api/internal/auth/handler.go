package auth

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}

	missing := map[string]string{}
	if req.Email == "" {
		missing["email"] = "required"
	}
	if req.Password == "" {
		missing["password"] = "required"
	}
	if len(missing) > 0 {
		httperr.Render(w, httperr.Unprocessable(missing))
		return
	}

	resp, err := h.svc.Login(r.Context(), req.Email, req.Password)
	if errors.Is(err, ErrInvalidCredentials) {
		httperr.Render(w, httperr.Unauthorized("invalid email or password"))
		return
	}
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) Logout(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	id := deps.CurrentUserID(r.Context())
	if id == 0 {
		httperr.Render(w, httperr.Unauthorized("not authenticated"))
		return
	}

	u, err := h.svc.Me(r.Context(), id)
	if errors.Is(err, users.ErrNotFound) {
		httperr.Render(w, httperr.Unauthorized("user no longer exists"))
		return
	}
	if err != nil {
		httperr.Render(w, httperr.Internal(err.Error()))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toMeUser(u))
}
