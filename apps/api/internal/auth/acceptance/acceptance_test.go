package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const (
	rightPassword = "Benar-pw1!"
	wrongPassword = "Salah-pw9!"
	adminPassword = "Admin-pw1!"
)

// ipSeq hands every request its own client address, so the per-IP login
// limiter only fires in the scenario that pins one on purpose.
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

// newServer builds the production router on the test database.
func (s *scenarioState) newServer() {
	cfg := app.Config{
		JWTSecret:          "auth-acceptance-secret",
		JWTExpiry:          time.Hour,
		RefreshTokenExpiry: 24 * time.Hour,
		CORSAllowedOrigins: []string{"*"},
	}
	pool := testutil.Pool(s.t)
	store := testutil.Store(s.t)
	s.srv = httptest.NewServer(app.NewRouter(cfg, pool, store, nil))
	s.repo = users.NewRepo(pool, store)
}

func (s *scenarioState) send(method, path, bearer, ip string, body any) error {
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

// captureTokens keeps the session a successful login or refresh returned.
func (s *scenarioState) captureTokens() error {
	if s.last.StatusCode != http.StatusOK {
		return nil
	}
	var resp auth.LoginResponse
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return fmt.Errorf("decode session: %w body=%s", err, s.body)
	}
	s.access = resp.Token
	s.refresh = resp.RefreshToken
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

// loggedInAgain opens a second session and keeps the first token for replay.
func (s *scenarioState) loggedInAgain() error {
	if err := s.logInRight(); err != nil {
		return err
	}
	return s.statusEquals(http.StatusOK)
}

func (s *scenarioState) logInUnknown() error {
	return s.loginAs(fmt.Sprintf("nobody_%d@example.test", time.Now().UnixNano()), rightPassword, "")
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

func (s *scenarioState) failLoginsFromOneAddress(n int) error {
	ip := nextIP()
	for range n {
		if err := s.loginAs(s.account.Email, wrongPassword, ip); err != nil {
			return err
		}
	}
	return nil
}

func (s *scenarioState) tokensIssued() error {
	var resp auth.LoginResponse
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	if resp.Token == "" || resp.RefreshToken == "" {
		return fmt.Errorf("want access and refresh token body=%s", s.body)
	}
	return nil
}

func (s *scenarioState) calls(path string) error {
	return s.send(http.MethodGet, path, s.access, "", nil)
}

func (s *scenarioState) refreshSession() error {
	if err := s.send(http.MethodPost, "/api/v1/auth/refresh", "", "",
		auth.RefreshRequest{RefreshToken: s.refresh}); err != nil {
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
	return s.send(http.MethodPost, "/api/v1/auth/refresh", "", "",
		auth.RefreshRequest{RefreshToken: s.firstRefresh})
}

func (s *scenarioState) refreshRotated() error {
	if s.refresh == "" || s.refresh == s.firstRefresh {
		return fmt.Errorf("refresh token was not rotated")
	}
	return nil
}

// backdateRevocations moves the account's revocations past the reuse grace.
func (s *scenarioState) backdateRevocations(secs int) error {
	_, err := testutil.Pool(s.t).Exec(context.Background(),
		`UPDATE refresh_tokens SET revoked_at = now() - make_interval(secs => $2)
		  WHERE user_id = $1 AND revoked_at IS NOT NULL`, s.account.ID, secs)
	return err
}

// admin signs a fresh superadmin in once per scenario.
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

// changeOwnPasswordDuringReset lands an admin reset while the change
// waits on the account row, after it verified the old password.
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

// waitBlockedOn polls until a backend waits on pid.
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
		sc.Step(`^the account has failed to log in (\d+) times$`, state.failLogins)
		sc.Step(`^the account logs in with a wrong password (\d+) times from one address$`, state.failLoginsFromOneAddress)
		sc.Step(`^the account is logged in$`, state.loggedIn)
		sc.Step(`^the response carries an access and a refresh token$`, state.tokensIssued)
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
		},
	}
	if status := suite.Run(); status != 0 {
		t.Fatalf("godog suite failed status=%d", status)
	}
}
