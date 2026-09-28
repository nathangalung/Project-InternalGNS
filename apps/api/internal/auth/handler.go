package auth

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Indonesian 401 problem details.
const (
	DetailNotSignedIn    = "Anda belum masuk. Silakan masuk terlebih dahulu."
	DetailSessionRevoked = "Sesi Anda tidak berlaku lagi. Silakan masuk kembali."
	DetailInvalidToken   = "Token akses tidak valid atau sudah kedaluwarsa. Silakan masuk kembali."
)

// Refresh refusal details.
var refreshDetails = []struct {
	err    error
	detail string
}{
	{ErrInvalidRefresh, "Token penyegar tidak valid. Silakan masuk kembali."},
	{ErrExpiredRefresh, "Sesi Anda sudah berakhir. Silakan masuk kembali."},
	{ErrReusedRefresh, "Token penyegar sudah pernah dipakai. Silakan masuk kembali."},
	{ErrRevokedRefresh, "Sesi Anda sudah diakhiri. Silakan masuk kembali."},
}

type Handler struct {
	svc     *Service
	cookies session.Cookies
	origins session.Origins
}

// NewHandler wires cookie rules.
// origins gates the cookie routes and must be the set CORS uses.
func NewHandler(svc *Service, cookies session.Cookies, origins session.Origins) *Handler {
	return &Handler{svc: svc, cookies: cookies, origins: origins}
}

// respond sets the cookie, writes the body.
// The refresh token never enters the body. A service without a refresh
// store mints none, so no cookie is set.
func (h *Handler) respond(w http.ResponseWriter, r *http.Request, s Session) {
	if s.RefreshToken != "" {
		h.cookies.Set(w, r, s.RefreshToken)
	}
	httpx.WriteJSON(w, http.StatusOK, s.LoginResponse)
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
	h.respond(w, r, resp)
}

// Logout ends the cookie's session.
// It revokes the token the cookie carries, if any, and expires the cookie.
// A stale tab without one still logs out.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if raw := session.Read(r); raw != "" {
		if err := h.svc.RevokeRefresh(r.Context(), raw); err != nil {
			httperr.RenderDBErr(w, err)
			return
		}
	}
	h.cookies.Clear(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// Refresh rotates the cookie's token.
// Only the cookie is read; a body is ignored. Every refusal expires the
// cookie, since the token it holds will never work again. An outage does
// not, so the client can retry.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	raw := session.Read(r)
	if raw == "" {
		h.cookies.Clear(w, r)
		httperr.Render(w, httperr.Unauthorized(DetailNotSignedIn))
		return
	}

	resp, err := h.svc.Refresh(r.Context(), raw)
	for _, rd := range refreshDetails {
		if errors.Is(err, rd.err) {
			h.cookies.Clear(w, r)
			httperr.Render(w, httperr.Unauthorized(rd.detail))
			return
		}
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	h.respond(w, r, resp)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	id := deps.CurrentUserID(r.Context())
	if id == 0 {
		httperr.Render(w, httperr.Unauthorized(DetailNotSignedIn))
		return
	}

	u, err := h.svc.Me(r.Context(), id)
	if errors.Is(err, users.ErrNotFound) {
		httperr.Render(w, httperr.Unauthorized(DetailSessionRevoked))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toMeUser(u))
}

// ChangeOwnPassword serves self-service changes.
// Any role may replace its own password.
func (h *Handler) ChangeOwnPassword(w http.ResponseWriter, r *http.Request) {
	id := deps.CurrentUserID(r.Context())
	if id == 0 {
		httperr.Render(w, httperr.Unauthorized(DetailNotSignedIn))
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
		h.cookies.Clear(w, r)
		httperr.Render(w, httperr.Unauthorized(DetailSessionRevoked))
		return
	case err != nil:
		httperr.RenderDBErr(w, err)
		return
	}
	// Every session ended, this one too; the client signs in again.
	h.cookies.Clear(w, r)
	w.WriteHeader(http.StatusNoContent)
}
