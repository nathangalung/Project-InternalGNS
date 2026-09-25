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
	"sync"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/golang-jwt/jwt/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Reason sent with guarded moves.
const testReason = "Klien tidak melanjutkan"

// Secret for the role router.
const roleJWTSecret = "quotation-role-secret"

// roleFixture holds per-role users.
// Users are created on first use and removed after the suite, once the
// quotation rows that reference them are gone.
type roleFixture struct {
	mu     sync.Mutex
	ids    map[string]int64
	server *httptest.Server
}

var roles = &roleFixture{ids: map[string]int64{}}

// roleTeardown clears rows, then users.
func roleTeardown(t *testing.T) {
	t.Cleanup(func() {
		roles.mu.Lock()
		defer roles.mu.Unlock()
		if len(roles.ids) == 0 {
			return
		}
		ctx := context.Background()
		pool := testutil.Pool(t)
		if err := testutil.ResetQuotationDomain(ctx, pool); err != nil {
			t.Errorf("reset quotation domain: %v", err)
			return
		}
		ids := make([]int64, 0, len(roles.ids))
		for _, id := range roles.ids {
			ids = append(ids, id)
		}
		for _, stmt := range []string{
			`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`,
			`DELETE FROM users WHERE id = ANY($1)`,
		} {
			if _, err := pool.Exec(ctx, stmt, ids); err != nil {
				t.Errorf("delete role users: %v", err)
			}
		}
		roles.ids = map[string]int64{}
	})
}

// userFor creates role users once.
func (s *scenarioState) userFor(role string) (int64, error) {
	roles.mu.Lock()
	defer roles.mu.Unlock()
	if id, ok := roles.ids[role]; ok {
		return id, nil
	}
	repo := users.NewRepo(testutil.Pool(s.t), testutil.Store(s.t))
	u, err := repo.Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("quotation-%s-%d@test.local", role, time.Now().UnixNano()),
		Name:     "Quotation " + role,
		Password: "Quotation-role-pw1!",
		Role:     users.Role(role),
	}, 1)
	if err != nil {
		return 0, fmt.Errorf("create %s user: %w", role, err)
	}
	roles.ids[role] = u.ID
	return u.ID, nil
}

// routerServer is the RBAC router.
func (s *scenarioState) routerServer() *httptest.Server {
	roles.mu.Lock()
	defer roles.mu.Unlock()
	if roles.server == nil {
		cfg := app.Config{
			Env:                "test",
			HTTPAddr:           ":0",
			DatabaseURL:        "ignored",
			JWTSecret:          roleJWTSecret,
			JWTExpiry:          time.Hour,
			CORSAllowedOrigins: []string{"http://localhost:5173"},
		}
		roles.server = httptest.NewServer(app.NewRouter(cfg, testutil.Pool(s.t), testutil.Store(s.t), nil))
		s.t.Cleanup(func() {
			roles.mu.Lock()
			defer roles.mu.Unlock()
			roles.server.Close()
			roles.server = nil
		})
	}
	return roles.server
}

// tokenFor mints a bearer token.
func tokenFor(userID int64, role string) (string, error) {
	now := time.Now()
	claims := auth.Claims{
		Role:           users.Role(role),
		SessionVersion: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(roleJWTSecret))
}

// actAs calls routes as role.
func (s *scenarioState) actAs(role, action string) error {
	base := "/quotations/" + strconv.FormatInt(s.lastID, 10)
	reason := testReason
	var method, url string
	var body any
	switch action {
	case "cancels":
		method, url, body = http.MethodPatch, base+"/status", quotations.ChangeStatusRequest{Status: quotations.StatusCancelled, Note: &reason}
	case "rejects":
		method, url, body = http.MethodPatch, base+"/status", quotations.ChangeStatusRequest{Status: quotations.StatusRejected, Note: &reason}
	case "revises":
		method, url, body = http.MethodPost, base+"/revise", quotations.ReviseRequest{}
	default:
		return fmt.Errorf("unknown action %q", action)
	}
	return s.callAs(role, method, url, body)
}

// callAs sends a role request.
// path is below /api/v1; a nil body sends none.
func (s *scenarioState) callAs(role, method, path string, body any) error {
	uid, err := s.userFor(role)
	if err != nil {
		return err
	}
	token, err := tokenFor(uid, role)
	if err != nil {
		return err
	}
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(mustJSON(body))
	}
	req, err := http.NewRequest(method, s.routerServer().URL+"/api/v1"+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	s.body, err = io.ReadAll(res.Body)
	s.last = res
	return err
}

func (s *scenarioState) tryWithReason(target string) error {
	reason := testReason
	return s.transitionWith(target, &reason)
}

func (s *scenarioState) tryWithoutReason(target string) error {
	return s.transitionWith(target, nil)
}

// statusStill rereads, keeping the response.
func (s *scenarioState) statusStill(want string) error {
	last, body := s.last, s.body
	defer func() { s.last, s.body = last, body }()
	if err := s.readDetail(); err != nil {
		return err
	}
	return s.detailStatusEquals(want)
}

func (s *scenarioState) problem() (httperr.Error, error) {
	var p httperr.Error
	if err := json.Unmarshal(s.body, &p); err != nil {
		return p, fmt.Errorf("decode problem %s: %w", s.body, err)
	}
	return p, nil
}

func (s *scenarioState) detailMentions(want string) error {
	p, err := s.problem()
	if err != nil {
		return err
	}
	if !strings.Contains(p.Detail, want) {
		return fmt.Errorf("detail %q lacks %q", p.Detail, want)
	}
	return nil
}

func (s *scenarioState) fieldNamed(field string) error {
	p, err := s.problem()
	if err != nil {
		return err
	}
	if strings.TrimSpace(p.Fields[field]) == "" {
		return fmt.Errorf("no message for field %q in %s", field, s.body)
	}
	return nil
}

func (s *scenarioState) detail() (quotations.QuotationDetail, error) {
	var d quotations.QuotationDetail
	if err := json.Unmarshal(s.body, &d); err != nil {
		return d, fmt.Errorf("decode detail %s: %w", s.body, err)
	}
	return d, nil
}

func (s *scenarioState) latestHistoryReason(to string) error {
	d, err := s.detail()
	if err != nil {
		return err
	}
	last := d.History[len(d.History)-1]
	if last.ToStatus != to || last.Note == nil || *last.Note != testReason {
		return fmt.Errorf("latest history %+v, want %s with %q", last, to, testReason)
	}
	return nil
}

func (s *scenarioState) latestHistorySystem(want string) error {
	d, err := s.detail()
	if err != nil {
		return err
	}
	last := d.History[len(d.History)-1]
	if last.ChangedBy != nil {
		return fmt.Errorf("latest history changed by %d, want the system", *last.ChangedBy)
	}
	if last.Note == nil || !strings.Contains(*last.Note, want) {
		return fmt.Errorf("latest history note %v lacks %q", last.Note, want)
	}
	return nil
}

func (s *scenarioState) allowedAre(want string) error {
	d, err := s.detail()
	if err != nil {
		return err
	}
	got := make([]string, 0, len(d.AllowedTransitions))
	for _, tr := range d.AllowedTransitions {
		got = append(got, tr.To)
	}
	if want == "none" {
		want = ""
	}
	if strings.Join(got, ",") != want {
		return fmt.Errorf("allowed %v, want %s", got, want)
	}
	if !bytes.Contains(s.body, []byte(`"allowedTransitions":[`)) {
		return fmt.Errorf("allowedTransitions must be an array: %s", s.body)
	}
	return nil
}

func (s *scenarioState) canRevise(want string) error {
	d, err := s.detail()
	if err != nil {
		return err
	}
	if d.CanRevise != (want == "yes") {
		return fmt.Errorf("canRevise %v, want %s", d.CanRevise, want)
	}
	return nil
}

func (s *scenarioState) reviseQuotation() error {
	if err := s.sendRequest(http.MethodPost, "/quotations/"+strconv.FormatInt(s.lastID, 10)+"/revise", nil); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		var resp map[string]int64
		if err := json.Unmarshal(s.body, &resp); err != nil {
			return err
		}
		s.origID, s.newID = s.lastID, resp["id"]
	}
	return nil
}

func (s *scenarioState) reviseUnknown(id int64) error {
	return s.sendRequest(http.MethodPost, "/quotations/"+strconv.FormatInt(id, 10)+"/revise", nil)
}

func (s *scenarioState) readByID(id int64) (quotations.QuotationDetail, error) {
	last, body := s.last, s.body
	defer func() { s.last, s.body = last, body }()
	if err := s.sendRequest(http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10), nil); err != nil {
		return quotations.QuotationDetail{}, err
	}
	return s.detail()
}

func (s *scenarioState) newRevisionIs(version int, suffix string) error {
	orig, err := s.readByID(s.origID)
	if err != nil {
		return err
	}
	rev, err := s.readByID(s.newID)
	if err != nil {
		return err
	}
	if rev.Status != quotations.StatusDraft || int(rev.Version) != version {
		return fmt.Errorf("revision status %s version %d", rev.Status, rev.Version)
	}
	if rev.QuotationNo != orig.QuotationNo+" "+suffix {
		return fmt.Errorf("revision number %q, want %q", rev.QuotationNo, orig.QuotationNo+" "+suffix)
	}
	return nil
}

func (s *scenarioState) originalIs(want string) error {
	orig, err := s.readByID(s.origID)
	if err != nil {
		return err
	}
	if orig.Status != want {
		return fmt.Errorf("original status %s, want %s", orig.Status, want)
	}
	return nil
}

func (s *scenarioState) chainHolds(n int) error {
	if err := s.sendRequest(http.MethodGet, "/quotations/"+strconv.FormatInt(s.newID, 10)+"/revisions", nil); err != nil {
		return err
	}
	var revs []quotations.RevisionRow
	if err := json.Unmarshal(s.body, &revs); err != nil {
		return err
	}
	if len(revs) != n {
		return fmt.Errorf("chain holds %d, want %d", len(revs), n)
	}
	return nil
}

func (s *scenarioState) editRevision() error {
	rev, err := s.readByID(s.newID)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPut, s.srv.URL+"/quotations/"+strconv.FormatInt(s.newID, 10),
		bytes.NewReader(mustJSON(quotations.UpdateRequest{
			DiscountPct: "5",
			Items: []quotations.CreateItem{{
				RequestedName: "BOLT M8", Qty: "10", UnitID: defaultUnit, SellingPrice: "20000",
			}},
		})))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Itoa(int(rev.RowVersion)))
	res, err := s.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	s.body, err = io.ReadAll(res.Body)
	s.last = res
	return err
}

func mustJSON(v any) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

func (s *scenarioState) sendRevision() error {
	return s.sendRequest(http.MethodPost, "/quotations/"+strconv.FormatInt(s.newID, 10)+"/send", nil)
}

func (s *scenarioState) readStats() error {
	return s.sendRequest(http.MethodGet, "/quotations/stats", nil)
}

func (s *scenarioState) stats() ([]quotations.StatusCount, error) {
	var out []quotations.StatusCount
	if err := json.Unmarshal(s.body, &out); err != nil {
		return nil, fmt.Errorf("decode stats %s: %w", s.body, err)
	}
	return out, nil
}

func (s *scenarioState) statsList(want string) error {
	st, err := s.stats()
	if err != nil {
		return err
	}
	got := make([]string, 0, len(st))
	for _, c := range st {
		got = append(got, c.Status)
	}
	if strings.Join(got, ",") != want {
		return fmt.Errorf("stats order %v, want %s", got, want)
	}
	return nil
}

func (s *scenarioState) statsLabels(want string) error {
	st, err := s.stats()
	if err != nil {
		return err
	}
	got := make([]string, 0, len(st))
	for _, c := range st {
		got = append(got, c.Label)
	}
	if strings.Join(got, ",") != want {
		return fmt.Errorf("stats labels %v, want %s", got, want)
	}
	return nil
}

func (s *scenarioState) statsCount(a int64, sa string, b int64, sb string) error {
	st, err := s.stats()
	if err != nil {
		return err
	}
	by := map[string]int64{}
	for _, c := range st {
		by[c.Status] = c.Count
	}
	if by[sa] != a || by[sb] != b {
		return fmt.Errorf("stats %s=%d %s=%d, want %d and %d", sa, by[sa], sb, by[sb], a, b)
	}
	return nil
}

// sentAt moves the send instant.
func (s *scenarioState) sentAt(at string, validity int) error {
	when, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return fmt.Errorf("parse send instant: %w", err)
	}
	ctx := context.Background()
	pool := testutil.Pool(s.t)
	if _, err := pool.Exec(ctx, `UPDATE quotations SET validity_days = $2 WHERE id = $1`, s.lastID, validity); err != nil {
		return err
	}
	tag, err := pool.Exec(ctx, `
		UPDATE quotation_status_history
		   SET changed_at = $2
		 WHERE quotation_id = $1 AND to_status = 'sent'`, s.lastID, when)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("moved %d sent rows, want 1", tag.RowsAffected())
	}
	return nil
}

// onceExpirer stops after one run.
type onceExpirer struct {
	repo   *quotations.Repo
	cancel context.CancelFunc
	err    error
}

func (o *onceExpirer) ExpireDue(ctx context.Context, asOf time.Time) (int64, error) {
	defer o.cancel()
	n, err := o.repo.ExpireDue(ctx, asOf)
	o.err = err
	return n, err
}

// runExpiryAt runs the loop once.
// The clock is injected, so the WIB boundary is exact.
func (s *scenarioState) runExpiryAt(at string) error {
	now, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return fmt.Errorf("parse job instant: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	once := &onceExpirer{
		repo:   quotations.NewRepo(testutil.Pool(s.t), testutil.Store(s.t)),
		cancel: cancel,
	}
	quotations.RunExpiryLoop(ctx, once, time.Hour, func() time.Time { return now })
	return once.err
}

func registerStatusSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^the user transitions the quotation through "([^"]+)" giving a reason$`, s.walkWithReason)
	sc.Step(`^the user tries to transition the quotation to "([^"]+)" giving a reason$`, s.tryWithReason)
	sc.Step(`^the user tries to transition the quotation to "([^"]+)" without a reason$`, s.tryWithoutReason)
	sc.Step(`^the quotation status is still "([^"]+)"$`, s.statusStill)
	sc.Step(`^the problem detail mentions "([^"]+)"$`, s.detailMentions)
	sc.Step(`^the problem names the field "([^"]+)"$`, s.fieldNamed)
	sc.Step(`^the latest history entry moves to "([^"]+)" with the reason$`, s.latestHistoryReason)
	sc.Step(`^the latest history entry is a system note mentioning "([^"]+)"$`, s.latestHistorySystem)
	sc.Step(`^the allowed transitions are "([^"]+)"$`, s.allowedAre)
	sc.Step(`^the quotation can be revised: (yes|no)$`, s.canRevise)
	sc.Step(`^the user revises the quotation$`, s.reviseQuotation)
	sc.Step(`^the user revises quotation (\d+)$`, s.reviseUnknown)
	sc.Step(`^the new revision is a draft at version (\d+) numbered "([^"]+)"$`, s.newRevisionIs)
	sc.Step(`^the original quotation status is "([^"]+)"$`, s.originalIs)
	sc.Step(`^the revision chain holds (\d+) quotations$`, s.chainHolds)
	sc.Step(`^the user edits the new revision$`, s.editRevision)
	sc.Step(`^the user sends the new revision$`, s.sendRevision)
	sc.Step(`^the user reads the quotation stats$`, s.readStats)
	sc.Step(`^the stats list "([^"]+)"$`, s.statsList)
	sc.Step(`^the stats labels are "([^"]+)"$`, s.statsLabels)
	sc.Step(`^the stats count (\d+) "([^"]+)" and (\d+) "([^"]+)"$`, s.statsCount)
	sc.Step(`^the quotation was sent at "([^"]+)" with a validity of (\d+) days$`, s.sentAt)
	sc.Step(`^the expiry job runs at "([^"]+)"$`, s.runExpiryAt)
	sc.Step(`^a "([^"]+)" user (cancels|revises|rejects) the quotation through the API$`, s.actAs)
}
