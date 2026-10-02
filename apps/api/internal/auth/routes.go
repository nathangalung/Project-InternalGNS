package auth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
)

// clientIPKey keys limits by client.
// The app router resolves the client with its clientIP middleware; IPv6
// clients share one bucket per /64. Without that middleware the key is empty
// and every request shares a single bucket, which only tightens the limit.
func clientIPKey(r *http.Request) (string, error) {
	return httprate.CanonicalizeIP(middleware.GetClientIP(r.Context())), nil
}

// limitBy limits per client IP.
// Each limiter counts on its own monotonic counter, so a wall-clock step
// cannot reset it.
func limitBy(requestLimit int) func(http.Handler) http.Handler {
	return httprate.LimitBy(requestLimit, time.Minute, clientIPKey,
		httprate.WithLimitCounter(newMonotonicCounter(time.Now)))
}

// Refresh limits per minute.
// Every page load and new tab rotates the cookie, and an office reaches the
// API from one public address, so the address only carries a flood ceiling.
// A 256-bit token needs no brute-force throttle; the per-cookie limit only
// stops one cookie being hammered.
const (
	refreshPerIP     = 300
	refreshPerCookie = 20
)

// refreshCookieKey keys by cookie hash.
// The limiter's map holds a digest, never a live token.
func refreshCookieKey(r *http.Request) (string, error) {
	sum := sha256.Sum256([]byte(session.Read(r)))
	return hex.EncodeToString(sum[:]), nil
}

// refreshLimit limits refresh calls.
// A request without a cookie is answered 401 before any database work, so
// it spends only the address ceiling: a signed-out office must reach the
// login page at once, not after a 429.
func refreshLimit(perIP, perCookie int) func(http.Handler) http.Handler {
	byIP := limitBy(perIP)
	byCookie := httprate.LimitBy(perCookie, time.Minute, refreshCookieKey,
		httprate.WithLimitCounter(newMonotonicCounter(time.Now)))
	return func(next http.Handler) http.Handler {
		limited := byCookie(next)
		return byIP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if session.Read(r) == "" {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		}))
	}
}

// Login and password limits.
// Every budget counts per minute.
// An office signs in from one public address at the start of the day, so
// the address carries only a flood ceiling and the tight budget is per
// account: per address and email for login, per user for a password change.
// Keying login on the address too keeps a stranger from spending a
// colleague's budget. loginBackoff in service.go also slows guessing.
const (
	loginPerIP      = 100
	loginPerAccount = 10
	passwordPerIP   = 100
	passwordPerUser = 5
)

// loginBodyMax bounds the login body.
// A login body is two short fields, about 100 bytes.
const loginBodyMax = 4 << 10

// errLoginTooLarge marks an oversized body.
var errLoginTooLarge = errors.New("login body too large")

// loginAccountKey keys address and email.
// It peeks the JSON body and hands it on unread to the handler, decoding
// the first value the way httpx.DecodeJSON does, so trailing bytes cannot
// move a login to another bucket. A body past loginBodyMax is refused. The
// key holds a digest of the trimmed, lower-cased email, the form the user
// lookup matches, never the address itself. A body it cannot read keys on
// the address alone.
func loginAccountKey(r *http.Request) (string, error) {
	ip, _ := clientIPKey(r)
	raw, err := io.ReadAll(io.LimitReader(r.Body, loginBodyMax+1))
	if len(raw) > loginBodyMax {
		return "", errLoginTooLarge
	}
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(raw), r.Body), r.Body}
	var body struct {
		Email string `json:"email"`
	}
	if readable := err == nil && json.NewDecoder(bytes.NewReader(raw)).Decode(&body) == nil; !readable {
		return ip, nil
	}
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(body.Email))))
	return ip + "|" + hex.EncodeToString(sum[:]), nil
}

// loginKeyError renders key failures.
// The only one the key raises is an oversized body; the counter never fails.
func loginKeyError(w http.ResponseWriter, _ *http.Request, err error) {
	if errors.Is(err, errLoginTooLarge) {
		httperr.Render(w, httperr.PayloadTooLarge(httpx.BodyTooLargeDetail))
		return
	}
	httperr.Render(w, httperr.Internal("login rate limit failed"))
}

// loginLimit limits login calls.
func loginLimit(perIP, perAccount int) func(http.Handler) http.Handler {
	byIP := limitBy(perIP)
	byAccount := httprate.LimitBy(perAccount, time.Minute, loginAccountKey,
		httprate.WithLimitCounter(newMonotonicCounter(time.Now)),
		httprate.WithErrorHandler(loginKeyError))
	return func(next http.Handler) http.Handler {
		return byIP(byAccount(next))
	}
}

// userKey keys by signed-in user.
func userKey(r *http.Request) (string, error) {
	return strconv.FormatInt(deps.CurrentUserID(r.Context()), 10), nil
}

// passwordLimit limits password changes.
func passwordLimit(perIP, perUser int) func(http.Handler) http.Handler {
	byIP := limitBy(perIP)
	byUser := httprate.LimitBy(perUser, time.Minute, userKey,
		httprate.WithLimitCounter(newMonotonicCounter(time.Now)))
	return func(next http.Handler) http.Handler {
		return byIP(byUser(next))
	}
}

// loginGuard stops login CSRF.
// Login sets the refresh cookie, so a cross-site form or a sibling subdomain
// posting to it would sign the reader into another account. A browser always
// sends Origin on a POST, so any Origin must be listed; a client without one
// (curl, a test harness) is no browser and plants nothing. Only JSON is read,
// a type a plain form cannot send.
func loginGuard(o session.Origins) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin := r.Header.Get("Origin"); origin != "" && !o.Allowed(origin) {
				httperr.Render(w, httperr.Forbidden(session.DetailOriginRefused))
				return
			}
			if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
				httperr.Render(w, httperr.Error{
					Type: "about:blank", Title: "Unsupported Media Type",
					Status: http.StatusUnsupportedMediaType, Detail: DetailJSONOnly,
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func Routes(h *Handler, requireAuth func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()

	// Every guard refuses before the limiter counts, so a foreign page cannot
	// spend a reader's login budget. The cookie routes also refuse a missing
	// Origin or CSRF header.
	r.With(loginGuard(h.origins), loginLimit(loginPerIP, loginPerAccount)).Post("/login", h.Login)
	guard := session.Guard(h.origins)
	r.With(guard, refreshLimit(refreshPerIP, refreshPerCookie)).Post("/refresh", h.Refresh)
	r.With(guard).Post("/logout", h.Logout)

	r.Group(func(r chi.Router) {
		r.Use(requireAuth)
		r.Get("/me", h.Me)
		r.With(passwordLimit(passwordPerIP, passwordPerUser)).Patch("/me/password", h.ChangeOwnPassword)
	})
	return r
}
