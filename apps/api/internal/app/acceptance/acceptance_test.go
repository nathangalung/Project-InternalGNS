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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/golang-jwt/jwt/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const jwtSecret = "rbac-acceptance-signing-secret"

// Suite-wide router and accounts.
type suite struct {
	t       *testing.T
	cleaner *testutil.Cleaner
	srv     *httptest.Server
	repo    *users.Repo
	run     int64
	seq     atomic.Int64

	mu    sync.Mutex
	users map[string]int64
}

func newSuite(t *testing.T) *suite {
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	s := &suite{
		t:       t,
		cleaner: testutil.NewCleaner(t),
		repo:    users.NewRepo(pool, store),
		run:     time.Now().UnixNano(),
		users:   map[string]int64{},
	}
	router := app.NewRouter(app.Config{
		JWTSecret:          jwtSecret,
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
	}, pool, store, nil)
	s.srv = httptest.NewServer(router)
	t.Cleanup(s.srv.Close)
	return s
}

// userFor returns one account per role.
// The auth middleware reads the role from the live account, so each role
// needs a real row, not just a claim.
func (s *suite) userFor(role string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.users[role]; ok {
		return id, nil
	}
	u, err := s.repo.Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("atdd-rbac-%s-%d@test.local", role, s.run),
		Name:     "ATDD RBAC " + role,
		Password: "Rbac-accept-pw1!",
		Role:     users.Role(role),
	}, 1)
	if err != nil {
		return 0, fmt.Errorf("create %s user: %w", role, err)
	}
	s.cleaner.User(u.ID)
	s.users[role] = u.ID
	return u.ID, nil
}

// bearer mints an access token the router accepts.
func bearer(userID int64, role string) (string, error) {
	now := time.Now()
	claims := auth.Claims{
		Role: users.Role(role),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(jwtSecret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return "Bearer " + signed, nil
}

// Per-scenario state.
type scenario struct {
	*suite
	token string
	last  *http.Response
	body  []byte
	email string
}

func (sc *scenario) signedInAs(role string) error {
	id, err := sc.userFor(role)
	if err != nil {
		return err
	}
	sc.token, err = bearer(id, role)
	return err
}

func (sc *scenario) notSignedIn() error {
	sc.token = ""
	return nil
}

func (sc *scenario) send(method, path string, body []byte) error {
	req, err := http.NewRequest(method, sc.srv.URL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if sc.token != "" {
		req.Header.Set("Authorization", sc.token)
	}
	res, err := sc.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	sc.last, sc.body = res, raw
	return nil
}

// sendTo carries an empty JSON body on writes.
// A request that got past the gate stops at validation and stores nothing.
func (sc *scenario) sendTo(method, path string) error {
	var body []byte
	if method != http.MethodGet {
		body = []byte("{}")
	}
	return sc.send(method, path, body)
}

func (sc *scenario) createUser() error {
	sc.email = fmt.Sprintf("atdd-rbac-new-%d-%d@test.local", sc.run, sc.seq.Add(1))
	raw, err := json.Marshal(map[string]string{
		"email":    sc.email,
		"name":     "ATDD RBAC created",
		"password": "Rbac-created-pw1!",
		"role":     "operational",
	})
	if err != nil {
		return err
	}
	if err := sc.send(http.MethodPost, "/api/v1/users/", raw); err != nil {
		return err
	}
	if sc.last.StatusCode == http.StatusCreated {
		var u struct {
			ID int64 `json:"id"`
		}
		if err := json.Unmarshal(sc.body, &u); err != nil {
			return err
		}
		sc.cleaner.User(u.ID)
	}
	return nil
}

func (sc *scenario) usersWithEmail() (int, error) {
	var n int
	err := testutil.Pool(sc.t).QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE lower(email) = lower($1)`, sc.email).Scan(&n)
	return n, err
}

func (sc *scenario) noUser() error {
	n, err := sc.usersWithEmail()
	if err != nil {
		return err
	}
	if n != 0 {
		return fmt.Errorf("%d users with %s after a refused create", n, sc.email)
	}
	return nil
}

func (sc *scenario) userExists() error {
	n, err := sc.usersWithEmail()
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("%d users with %s, want 1", n, sc.email)
	}
	return nil
}

func (sc *scenario) statusIs(want int) error {
	if sc.last.StatusCode != want {
		return fmt.Errorf("status = %d, want %d; body=%s", sc.last.StatusCode, want, sc.body)
	}
	return nil
}

func (sc *scenario) detailIs(want string) error {
	if ct := sc.last.Header.Get("Content-Type"); ct != "application/problem+json" {
		return fmt.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	var p struct {
		Status int    `json:"status"`
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(sc.body, &p); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, sc.body)
	}
	if p.Status != sc.last.StatusCode {
		return fmt.Errorf("problem status %d, response %d", p.Status, sc.last.StatusCode)
	}
	if p.Detail != want {
		return fmt.Errorf("detail = %q, want %q", p.Detail, want)
	}
	return nil
}

func initScenario(s *suite) func(*godog.ScenarioContext) {
	return func(ctx *godog.ScenarioContext) {
		sc := &scenario{suite: s}
		ctx.Before(func(c context.Context, _ *godog.Scenario) (context.Context, error) {
			*sc = scenario{suite: s}
			return c, nil
		})
		ctx.Step(`^I am signed in as "([^"]*)"$`, sc.signedInAs)
		ctx.Step(`^I am not signed in$`, sc.notSignedIn)
		ctx.Step(`^I send "([^"]*)" to "([^"]*)"$`, sc.sendTo)
		ctx.Step(`^I create a user with a fresh email$`, sc.createUser)
		ctx.Step(`^no user with that email exists$`, sc.noUser)
		ctx.Step(`^a user with that email exists$`, sc.userExists)
		ctx.Step(`^the response status is (\d+)$`, sc.statusIs)
		ctx.Step(`^the problem detail is "([^"]*)"$`, sc.detailIs)
	}
}

func TestRBACFeatures(t *testing.T) {
	testutil.RequireDB(t)
	s := newSuite(t)
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(s),
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
