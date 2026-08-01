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
	// One neutral 401 for every credential failure: a distinct "email not
	// registered" reply enumerated accounts for anyone who could POST.
	if errors.Is(err, ErrInvalidCredentials) {
		httperr.Render(w, httperr.Unauthorized("invalid email or password"))
		return
	}
	if errors.Is(err, ErrAccountLocked) {
		httperr.Render(w, httperr.TooManyRequests("account temporarily locked, try again later"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	var req LogoutRequest
	// Body is optional — old clients that haven't been redeployed still send
	// nothing. Best-effort decode then revoke.
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.RefreshToken != "" {
		if err := h.svc.RevokeRefresh(r.Context(), req.RefreshToken); err != nil {
			httperr.RenderDBErr(w, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	if req.RefreshToken == "" {
		httperr.Render(w, httperr.Unprocessable(map[string]string{"refreshToken": "required"}))
		return
	}

	resp, err := h.svc.Refresh(r.Context(), req.RefreshToken)
	switch {
	case errors.Is(err, ErrInvalidRefresh),
		errors.Is(err, ErrExpiredRefresh),
		errors.Is(err, ErrReusedRefresh):
		httperr.Render(w, httperr.Unauthorized(err.Error()))
		return
	case err != nil:
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
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
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toMeUser(u))
}
