package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/golang-jwt/jwt/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// spaOrigin is the listed origin.
const spaOrigin = "http://spa.test"

const (
	rightPassword = "Benar-pw1!"
	wrongPassword = "Salah-pw9!"
	adminPassword = "Admin-pw1!"
)

// ipSeq varies each client address.
// Every request gets its own address, so the per-IP login limiter only
// fires in the scenario that pins one on purpose.
var ipSeq atomic.Int64

func nextIP() string {
	n := ipSeq.Add(1)
	return fmt.Sprintf("10.%d.%d.%d", (n>>16)&0xff, (n>>8)&0xff, n&0xff)
}

type scenarioState struct {
	t       *testing.T
	cleaner *testutil.Cleaner
	srv     *httptest.Server
	repo    *users.Repo

	last *http.Response
	body []byte

	account      users.User
	password     string
	access       string
	refresh      string
	firstRefresh string

	adminToken string
}

// newServer builds the production router.
// It runs on the test database.
func (s *scenarioState) newServer() {
	cfg := app.Config{
		JWTSecret:          "auth-acceptance-secret",
		JWTExpiry:          time.Hour,
		RefreshTokenExpiry: 24 * time.Hour,
		Env:                "test",
		CORSAllowedOrigins: []string{spaOrigin},
	}
	pool := testutil.Pool(s.t)
	store := testutil.Store(s.t)
	s.srv = httptest.NewServer(app.NewRouter(cfg, pool, store, nil))
	s.repo = users.NewRepo(pool, store)
}

func (s *scenarioState) send(method, path, bearer, ip string, body any) error {
	return s.sendWith(method, path, bearer, ip, body, nil)
}

// sendWith lets a step shape headers.
func (s *scenarioState) sendWith(method, path, bearer, ip string, body any, shape func(*http.Request)) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, s.srv.URL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if ip == "" {
		ip = nextIP()
	}
	req.Header.Set("X-Forwarded-For", ip)
	if shape != nil {
		shape(req)
	}
	res, err := s.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	s.last = res
	s.body = raw
	return nil
}

func (s *scenarioState) createUser(role users.Role, password string) (users.User, error) {
	u, err := s.repo.Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("atdd_auth_%d@example.test", time.Now().UnixNano()),
		Name:     "ATDD Auth",
		Password: password,
		Role:     role,
	}, 1)
	if err != nil {
		return users.User{}, fmt.Errorf("create %s: %w", role, err)
	}
	s.cleaner.User(u.ID)
	return u, nil
}

func (s *scenarioState) activeAccount(role string) error {
	s.newServer()
	u, err := s.createUser(users.Role(role), rightPassword)
	if err != nil {
		return err
	}
	s.account = u
	s.password = rightPassword
	return nil
}

func (s *scenarioState) loginAs(email, password, ip string) error {
	return s.send(http.MethodPost, "/api/v1/auth/login", "", ip,
		auth.LoginRequest{Email: email, Password: password})
}

// captureTokens keeps the returned session.
// It stores what a successful login or refresh returned.
func (s *scenarioState) captureTokens() error {
	if s.last.StatusCode != http.StatusOK {
		return nil
	}
	var resp auth.LoginResponse
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return fmt.Errorf("decode session: %w body=%s", err, s.body)
	}
	s.access = resp.Token
	if c := s.refreshCookie(); c != nil && c.Value != "" {
		s.refresh = c.Value
	}
	return nil
}

func (s *scenarioState) logIn(password string) error {
	if err := s.loginAs(s.account.Email, password, ""); err != nil {
		return err
	}
	return s.captureTokens()
}

func (s *scenarioState) logInRight() error { return s.logIn(s.password) }

func (s *scenarioState) logInWrong() error { return s.loginAs(s.account.Email, wrongPassword, "") }

func (s *scenarioState) loggedIn() error {
	if err := s.logInRight(); err != nil {
		return err
	}
	if err := s.statusEquals(http.StatusOK); err != nil {
		return err
	}
	s.firstRefresh = s.refresh
	return nil
}

// loggedInAgain opens a second session.
// It keeps the first token for replay.
func (s *scenarioState) loggedInAgain() error {
	if err := s.logInRight(); err != nil {
		return err
	}
	return s.statusEquals(http.StatusOK)
}

func (s *scenarioState) logInUnknown() error {
	return s.loginAs(fmt.Sprintf("nobody_%d@example.test", time.Now().UnixNano()), rightPassword, "")
}

// logInUnknownFromOneAddress repeats one unknown email.
// An unknown email pays the backoff an account would, so ten misses in a
// row would wait out almost eight seconds. All but the last go out at once,
// overlapping their delays; the limiter counts each on arrival, so the last
// meets it.
func (s *scenarioState) logInUnknownFromOneAddress(n int) error {
	ip := nextIP()
	email := fmt.Sprintf("nobody_%d@example.test", time.Now().UnixNano())
	body, err := json.Marshal(auth.LoginRequest{Email: email, Password: rightPassword})
	if err != nil {
		return err
	}
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		errs []error
	)
	for range n - 1 {
		wg.Go(func() {
			if err := s.postBlind("/api/v1/auth/login", ip, body); err != nil {
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return err
	}
	return s.loginAs(email, rightPassword, ip)
}

// postBlind posts and drops the answer.
// It leaves the scenario's last response alone, so goroutines may share it.
func (s *scenarioState) postBlind(path, ip string, body []byte) error {
	req, err := http.NewRequest(http.MethodPost, s.srv.URL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", ip)
	res, err := s.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	_, err = io.Copy(io.Discard, res.Body)
	return err
}

// colleaguesLogIn shares one office address.
func (s *scenarioState) colleaguesLogIn(n int) error {
	ip := nextIP()
	for i := range n {
		u, err := s.createUser(users.RoleOperational, rightPassword)
		if err != nil {
			return err
		}
		if err := s.loginAs(u.Email, rightPassword, ip); err != nil {
			return err
		}
		if s.last.StatusCode != http.StatusOK {
			return fmt.Errorf("colleague %d got %d body=%s", i+1, s.last.StatusCode, s.body)
		}
	}
	return nil
}

func (s *scenarioState) failLogins(n int) error {
	for range n {
		if err := s.logInWrong(); err != nil {
			return err
		}
		if err := s.statusEquals(http.StatusUnauthorized); err != nil {
			return err
		}
	}
	return nil
}

func (s *scenarioState) tokensIssued() error {
	var resp map[string]any
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	if tok, _ := resp["token"].(string); tok == "" {
		return fmt.Errorf("want an access token body=%s", s.body)
	}
	if _, ok := resp["refreshToken"]; ok {
		return fmt.Errorf("want no refreshToken member body=%s", s.body)
	}
	c := s.refreshCookie()
	if c == nil || c.Value == "" {
		return fmt.Errorf("want a refresh cookie got %v", s.last.Header.Values("Set-Cookie"))
	}
	if strings.Contains(string(s.body), c.Value) {
		return fmt.Errorf("the refresh token leaked into the body=%s", s.body)
	}
	return nil
}

func (s *scenarioState) calls(path string) error {
	return s.send(http.MethodGet, path, s.access, "", nil)
}

func (s *scenarioState) refreshSession() error {
	if err := s.cookiePost("/api/v1/auth/refresh", s.refresh, nil); err != nil {
		return err
	}
	return s.captureTokens()
}

func (s *scenarioState) refreshedSession() error {
	if err := s.refreshSession(); err != nil {
		return err
	}
	return s.statusEquals(http.StatusOK)
}

func (s *scenarioState) replayFirstRefresh() error {
	return s.cookiePost("/api/v1/auth/refresh", s.firstRefresh, nil)
}

func (s *scenarioState) refreshRotated() error {
	if s.refresh == "" || s.refresh == s.firstRefresh {
		return fmt.Errorf("refresh token was not rotated")
	}
	return nil
}

// backdateRevocations passes the reuse grace.
// It moves the account's revocations back that far.
func (s *scenarioState) backdateRevocations(secs int) error {
	_, err := testutil.Pool(s.t).Exec(context.Background(),
		`UPDATE refresh_tokens SET revoked_at = now() - make_interval(secs => $2)
		  WHERE user_id = $1 AND revoked_at IS NOT NULL`, s.account.ID, secs)
	return err
}

// admin signs in a superadmin.
// A fresh one signs in once per scenario.
func (s *scenarioState) admin() (string, error) {
	if s.adminToken != "" {
		return s.adminToken, nil
	}
	a, err := s.createUser(users.RoleSuperadmin, adminPassword)
	if err != nil {
		return "", err
	}
	if err := s.loginAs(a.Email, adminPassword, ""); err != nil {
		return "", err
	}
	if s.last.StatusCode != http.StatusOK {
		return "", fmt.Errorf("admin login got %d body=%s", s.last.StatusCode, s.body)
	}
	var resp auth.LoginResponse
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return "", err
	}
	s.adminToken = resp.Token
	return s.adminToken, nil
}

func (s *scenarioState) adminUpdate(role users.Role, active bool) error {
	token, err := s.admin()
	if err != nil {
		return err
	}
	return s.send(http.MethodPut, "/api/v1/users/"+strconv.FormatInt(s.account.ID, 10), token, "",
		users.UpdateUserRequest{Email: s.account.Email, Name: s.account.Name, Role: role, IsActive: active})
}

func (s *scenarioState) adminChangesRole(role string) error {
	return s.adminUpdate(users.Role(role), true)
}

func (s *scenarioState) adminChangedRole(role string) error {
	if err := s.adminChangesRole(role); err != nil {
		return err
	}
	return s.statusEquals(http.StatusOK)
}

func (s *scenarioState) adminDeactivates() error {
	return s.adminUpdate(s.account.Role, false)
}

func (s *scenarioState) adminResetsPassword(pw string) error {
	token, err := s.admin()
	if err != nil {
		return err
	}
	return s.send(http.MethodPatch, "/api/v1/users/"+strconv.FormatInt(s.account.ID, 10)+"/password",
		token, "", users.ChangePasswordRequest{Password: pw})
}

func (s *scenarioState) noFailedAttempts() error {
	st, err := s.repo.LockStatus(context.Background(), s.account.Email)
	if err != nil {
		return err
	}
	if st.FailedLoginAttempts != 0 {
		return fmt.Errorf("want 0 failed attempts got %d", st.FailedLoginAttempts)
	}
	return nil
}

func (s *scenarioState) changeOwnPassword(current, next string) error {
	return s.send(http.MethodPatch, "/api/v1/auth/me/password", s.access, "",
		auth.ChangeOwnPasswordRequest{CurrentPassword: current, NewPassword: next})
}

// Own change during admin reset.
// The reset lands while the change waits on the account row, after it
// verified the old password.
func (s *scenarioState) changeOwnPasswordDuringReset(next, reset string) error {
	ctx := context.Background()
	pool := testutil.Pool(s.t)
	holder, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = holder.Rollback(ctx) }()
	if _, err := holder.Exec(ctx, `UPDATE users SET updated_at = updated_at WHERE id = $1`, s.account.ID); err != nil {
		return err
	}
	var pid int
	if err := holder.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		return err
	}

	done := make(chan error, 1)
	go func() { done <- s.changeOwnPassword(s.password, next) }()
	if err := s.waitBlockedOn(ctx, pid, done); err != nil {
		return err
	}

	if err := users.NewRepo(holder, testutil.Store(s.t)).UpdatePassword(ctx, s.account.ID, reset, 1); err != nil {
		return err
	}
	if err := holder.Commit(ctx); err != nil {
		return err
	}
	return <-done
}

// waitBlockedOn polls for a waiter.
// It returns once some backend waits on pid.
func (s *scenarioState) waitBlockedOn(ctx context.Context, pid int, done <-chan error) error {
	deadline := time.After(5 * time.Second)
	for {
		var waiting bool
		if err := testutil.Pool(s.t).QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))`,
			pid).Scan(&waiting); err != nil {
			return err
		}
		if waiting {
			return nil
		}
		select {
		case err := <-done:
			return fmt.Errorf("the change finished without waiting for the reset: %v", err)
		case <-deadline:
			return fmt.Errorf("the change never waited for the reset")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func (s *scenarioState) logOut() error {
	return s.cookiePost("/api/v1/auth/logout", s.refresh, nil)
}

// expireRefresh backdates token expiry.
func (s *scenarioState) expireRefresh() error {
	_, err := testutil.Pool(s.t).Exec(context.Background(),
		`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, s.account.ID)
	return err
}

func (s *scenarioState) refreshWith(token string) error {
	return s.cookiePost("/api/v1/auth/refresh", token, nil)
}

// callsForged re-signs with another key.
func (s *scenarioState) callsForged(path string) error {
	var claims auth.Claims
	if _, _, err := jwt.NewParser().ParseUnverified(s.access, &claims); err != nil {
		return fmt.Errorf("read access token: %w", err)
	}
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("not-the-server-key"))
	if err != nil {
		return err
	}
	return s.send(http.MethodGet, path, forged, "", nil)
}

// postRaw sends a verbatim body.
func (s *scenarioState) postRaw(path string, doc *godog.DocString) error {
	req, err := http.NewRequest(http.MethodPost, s.srv.URL+path, strings.NewReader(doc.Content))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", nextIP())
	res, err := s.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	s.body, err = io.ReadAll(res.Body)
	s.last = res
	return err
}

// loggedInAs signs in a role.
func (s *scenarioState) loggedInAs(role string) error {
	u, err := s.createUser(users.Role(role), rightPassword)
	if err != nil {
		return err
	}
	s.account = u
	s.password = rightPassword
	return s.loggedIn()
}

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) problemDetail(want string) error {
	var p struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(s.body, &p); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, s.body)
	}
	if p.Detail != want {
		return fmt.Errorf("want detail %q got %q", want, p.Detail)
	}
	return nil
}

func (s *scenarioState) isProblemJSON() error {
	if ct := s.last.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		return fmt.Errorf("want problem+json got %q body=%s", ct, s.body)
	}
	return nil
}

func initScenario(t *testing.T, cleaner *testutil.Cleaner) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t, cleaner: cleaner}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			*state = scenarioState{t: t, cleaner: cleaner}
			return ctx, nil
		})
		sc.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
			if state.srv != nil {
				state.srv.Close()
			}
			return ctx, nil
		})

		sc.Step(`^an active "([^"]+)" account$`, state.activeAccount)
		sc.Step(`^the account logs in with the right password$`, state.logInRight)
		sc.Step(`^the account logs in with a wrong password$`, state.logInWrong)
		sc.Step(`^the account logs in with the password "([^"]+)"$`, state.logIn)
		sc.Step(`^the account logged in again$`, state.loggedInAgain)
		sc.Step(`^someone logs in as an unknown email$`, state.logInUnknown)
		sc.Step(`^someone logs in as one unknown email (\d+) times from one address, all but the last at once$`, state.logInUnknownFromOneAddress)
		sc.Step(`^(\d+) colleagues log in with the right password from one address$`, state.colleaguesLogIn)
		sc.Step(`^the account has failed to log in (\d+) times$`, state.failLogins)
		sc.Step(`^the account is logged in$`, state.loggedIn)
		sc.Step(`^the response carries an access token and no refresh token$`, state.tokensIssued)
		sc.Step(`^the refresh cookie is HttpOnly, Secure, SameSite=Strict and scoped to "([^"]+)"$`, state.cookieAttributes)
		sc.Step(`^the refresh cookie is cleared$`, state.cookieCleared)
		sc.Step(`^the refresh cookie is left alone$`, state.cookieLeftAlone)
		sc.Step(`^the account sends its refresh token in the body instead of the cookie$`, state.refreshInBody)
		sc.Step(`^the account logs in from the origin "([^"]+)" as "([^"]+)"$`, state.logInFrom)
		sc.Step(`^the account posts to "([^"]+)" from the origin "([^"]+)"$`, state.postFromOrigin)
		sc.Step(`^the account posts to "([^"]+)" without an Origin$`, state.postWithoutOrigin)
		sc.Step(`^the account posts to "([^"]+)" without the CSRF header$`, state.postWithoutCSRF)
		sc.Step(`^a page at "([^"]+)" preflights "([^"]+)"$`, state.preflight)
		sc.Step(`^the response grants no credentials$`, state.grantsNoCredentials)
		sc.Step(`^the response grants credentials to "([^"]+)"$`, state.grantsCredentialsTo)
		sc.Step(`^the account calls "([^"]+)"$`, state.calls)
		sc.Step(`^someone calls "([^"]+)" without a token$`, func(path string) error {
			return state.send(http.MethodGet, path, "", "", nil)
		})
		sc.Step(`^the account refreshes its session$`, state.refreshSession)
		sc.Step(`^the account refreshed its session$`, state.refreshedSession)
		sc.Step(`^the account replays the first refresh token$`, state.replayFirstRefresh)
		sc.Step(`^the refresh token was rotated$`, state.refreshRotated)
		sc.Step(`^the revocations happened (\d+) seconds ago$`, state.backdateRevocations)
		sc.Step(`^a superadmin changes the account role to "([^"]+)"$`, state.adminChangesRole)
		sc.Step(`^a superadmin changed the account role to "([^"]+)"$`, state.adminChangedRole)
		sc.Step(`^a superadmin deactivates the account$`, state.adminDeactivates)
		sc.Step(`^a superadmin resets the account password to "([^"]+)"$`, state.adminResetsPassword)
		sc.Step(`^the account has no failed login attempts$`, state.noFailedAttempts)
		sc.Step(`^the account changes its own password to "([^"]+)"$`, func(pw string) error {
			return state.changeOwnPassword(state.password, pw)
		})
		sc.Step(`^the account changes its own password with a wrong current password$`, func() error {
			return state.changeOwnPassword(wrongPassword, "Baru-pw2@")
		})
		sc.Step(`^the account changes its own password to "([^"]+)" while a superadmin resets it to "([^"]+)"$`,
			state.changeOwnPasswordDuringReset)
		sc.Step(`^the account logs out$`, state.logOut)
		sc.Step(`^the refresh token expired a minute ago$`, state.expireRefresh)
		sc.Step(`^someone refreshes with the token "([^"]*)"$`, state.refreshWith)
		sc.Step(`^the account calls "([^"]+)" with its token signed by another key$`, state.callsForged)
		sc.Step(`^someone posts to "([^"]+)":$`, state.postRaw)
		sc.Step(`^a logged-in "([^"]+)" account$`, state.loggedInAs)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the problem detail is "([^"]+)"$`, state.problemDetail)
		sc.Step(`^the response is problem\+json$`, state.isProblemJSON)
	}
}

func TestAuthFeatures(t *testing.T) {
	testutil.RequireDB(t)
	cleaner := testutil.NewCleaner(t)
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(t, cleaner),
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features"},
			TestingT: t,
			Strict:   true,
		},
	}
	if status := suite.Run(); status != 0 {
		t.Fatalf("godog suite failed status=%d", status)
	}
}

// cookiePost calls a cookie route.
// It sends what the SPA sends: the listed Origin, the CSRF header and, when
// token is set, the refresh cookie. shape may then strip or alter any of it.
func (s *scenarioState) cookiePost(path, token string, shape func(*http.Request)) error {
	return s.sendWith(http.MethodPost, path, "", "", nil, func(r *http.Request) {
		r.Header.Set("Origin", spaOrigin)
		r.Header.Set(session.CSRFHeader, "1")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: session.CookieName, Value: token})
		}
		if shape != nil {
			shape(r)
		}
	})
}

// refreshCookie reads the last Set-Cookie.
func (s *scenarioState) refreshCookie() *http.Cookie {
	for _, c := range s.last.Cookies() {
		if c.Name == session.CookieName {
			return c
		}
	}
	return nil
}

func (s *scenarioState) cookieAttributes(path string) error {
	c := s.refreshCookie()
	switch {
	case c == nil || c.Value == "":
		return fmt.Errorf("no refresh cookie in %v", s.last.Header.Values("Set-Cookie"))
	case !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode:
		return fmt.Errorf("want HttpOnly, Secure, SameSite=Strict got %q", c.Raw)
	case c.Path != path || c.Domain != "":
		return fmt.Errorf("want host-only Path=%s got %q", path, c.Raw)
	case c.MaxAge != 0 || !c.Expires.IsZero():
		return fmt.Errorf("want a session cookie without Max-Age or Expires got %q", c.Raw)
	}
	return nil
}

func (s *scenarioState) cookieCleared() error {
	c := s.refreshCookie()
	if c == nil || c.Value != "" || c.MaxAge >= 0 || c.Path != session.CookiePath || !c.Secure {
		return fmt.Errorf("want the refresh cookie expired got %v", s.last.Header.Values("Set-Cookie"))
	}
	return nil
}

func (s *scenarioState) cookieLeftAlone() error {
	if c := s.refreshCookie(); c != nil {
		return fmt.Errorf("want no refresh Set-Cookie got %v", s.last.Header.Values("Set-Cookie"))
	}
	return nil
}

// refreshInBody uses the old contract.
func (s *scenarioState) refreshInBody() error {
	return s.sendWith(http.MethodPost, "/api/v1/auth/refresh", "", "",
		map[string]string{"refreshToken": s.refresh}, func(r *http.Request) {
			r.Header.Set("Origin", spaOrigin)
			r.Header.Set(session.CSRFHeader, "1")
		})
}

// logInFrom shapes a login request.
// It sends the right password with the given Origin and Content-Type.
func (s *scenarioState) logInFrom(origin, contentType string) error {
	return s.sendWith(http.MethodPost, "/api/v1/auth/login", "", "",
		auth.LoginRequest{Email: s.account.Email, Password: s.password}, func(r *http.Request) {
			r.Header.Set("Origin", origin)
			r.Header.Set("Content-Type", contentType)
		})
}

func (s *scenarioState) postFromOrigin(path, origin string) error {
	return s.cookiePost(path, s.refresh, func(r *http.Request) { r.Header.Set("Origin", origin) })
}

func (s *scenarioState) postWithoutOrigin(path string) error {
	return s.cookiePost(path, s.refresh, func(r *http.Request) { r.Header.Del("Origin") })
}

func (s *scenarioState) postWithoutCSRF(path string) error {
	return s.cookiePost(path, s.refresh, func(r *http.Request) { r.Header.Del(session.CSRFHeader) })
}

func (s *scenarioState) preflight(origin, path string) error {
	s.newServerIfMissing()
	return s.sendWith(http.MethodOptions, path, "", "", nil, func(r *http.Request) {
		r.Header.Set("Origin", origin)
		r.Header.Set("Access-Control-Request-Method", http.MethodPost)
		r.Header.Set("Access-Control-Request-Headers", "x-gns-csrf")
	})
}

func (s *scenarioState) newServerIfMissing() {
	if s.srv == nil {
		s.newServer()
	}
}

func (s *scenarioState) grantsNoCredentials() error {
	h := s.last.Header
	if h.Get("Access-Control-Allow-Origin") != "" || h.Get("Access-Control-Allow-Credentials") != "" {
		return fmt.Errorf("want no CORS grant got %v", h)
	}
	return nil
}

func (s *scenarioState) grantsCredentialsTo(origin string) error {
	h := s.last.Header
	if h.Get("Access-Control-Allow-Origin") != origin || h.Get("Access-Control-Allow-Credentials") != "true" {
		return fmt.Errorf("want a credentialed grant to %s got %v", origin, h)
	}
	return nil
}
