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

	// Field messages reach the user verbatim, so they read as sentences.
	missing := map[string]string{}
	if req.Email == "" {
		missing["email"] = "Email wajib diisi."
	}
	if req.Password == "" {
		missing["password"] = "Kata sandi wajib diisi."
	}
	if len(missing) > 0 {
		httperr.Render(w, httperr.Unprocessable(missing))
		return
	}

	resp, err := h.svc.Login(r.Context(), req.Email, req.Password)
	// One neutral 401 for every credential failure: a distinct "email not
	// registered" reply enumerated accounts for anyone who could POST.
	if errors.Is(err, ErrInvalidCredentials) {
		httperr.Render(w, httperr.Unauthorized("Email atau kata sandi salah."))
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
		httperr.Render(w, httperr.Unprocessable(map[string]string{"refreshToken": "Token penyegar wajib diisi."}))
		return
	}

	resp, err := h.svc.Refresh(r.Context(), req.RefreshToken)
	switch {
	case errors.Is(err, ErrInvalidRefresh),
		errors.Is(err, ErrExpiredRefresh),
		errors.Is(err, ErrReusedRefresh),
		errors.Is(err, ErrRevokedRefresh):
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

// ChangeOwnPassword lets any role replace its own password.
func (h *Handler) ChangeOwnPassword(w http.ResponseWriter, r *http.Request) {
	id := deps.CurrentUserID(r.Context())
	if id == 0 {
		httperr.Render(w, httperr.Unauthorized("not authenticated"))
		return
	}

	var req ChangeOwnPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Render(w, httperr.BadRequest("invalid json"))
		return
	}
	fields := map[string]string{}
	if req.CurrentPassword == "" {
		fields["currentPassword"] = "Kata sandi saat ini wajib diisi."
	}
	if msg := users.ValidatePassword(req.NewPassword); msg != "" {
		fields["newPassword"] = msg
	}
	if len(fields) > 0 {
		httperr.Render(w, httperr.Unprocessable(fields))
		return
	}

	err := h.svc.ChangeOwnPassword(r.Context(), id, req.CurrentPassword, req.NewPassword)
	switch {
	// 422, not 401: the SPA reads any 401 as an expired session.
	case errors.Is(err, ErrWrongCurrentPassword):
		httperr.Render(w, httperr.Unprocessable(map[string]string{
			"currentPassword": "Kata sandi saat ini salah.",
		}))
		return
	// 409: the password is right, but a newer change already replaced it.
	case errors.Is(err, ErrPasswordChanged):
		httperr.Render(w, httperr.Conflict(
			"Kata sandi akun ini baru saja diubah di tempat lain. Masuk kembali dengan kata sandi terbaru."))
		return
	case errors.Is(err, ErrSessionRevoked):
		httperr.Render(w, httperr.Unauthorized("session is no longer valid"))
		return
	case err != nil:
		httperr.RenderDBErr(w, err)
		return
	}
	// Every session ended, this one too; the client signs in again.
	w.WriteHeader(http.StatusNoContent)
}
