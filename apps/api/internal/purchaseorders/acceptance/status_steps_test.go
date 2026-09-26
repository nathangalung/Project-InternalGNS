package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const (
	roleUserPassword = "Benar-pw1!"
	testCancelReason = "Dibatalkan untuk pengujian"
)

var loginIPSeq atomic.Uint32

// Distinct client IP per login.
func nextLoginIP() string {
	n := loginIPSeq.Add(1)
	return fmt.Sprintf("10.61.%d.%d", (n>>8)&0xff, n&0xff)
}

func (s *scenarioState) poPath(suffix string) string {
	return "/purchase-orders/" + strconv.FormatInt(s.poID, 10) + suffix
}

func (s *scenarioState) currentPOStatus() (purchaseorders.Status, error) {
	if err := s.readPOByQuotation(); err != nil {
		return "", err
	}
	if s.last.StatusCode != http.StatusOK {
		return "", fmt.Errorf("po fetch want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return "", err
	}
	return po.Status, nil
}

// Walk the canonical path.
func (s *scenarioState) reachPOStatus(target string) error {
	want := purchaseorders.Status(target)
	if want == purchaseorders.StatusCancelled {
		if err := s.cancelPO(testCancelReason); err != nil {
			return err
		}
		return s.lastTransitionSucceeds()
	}
	for range 4 {
		cur, err := s.currentPOStatus()
		if err != nil {
			return err
		}
		if cur == want {
			return nil
		}
		switch cur {
		case purchaseorders.StatusPending:
			err = s.uploadPOFile("po.pdf")
		case purchaseorders.StatusUploaded:
			err = s.transitionPOTo(string(purchaseorders.StatusOnProgress))
		case purchaseorders.StatusOnProgress:
			err = s.transitionPOTo(string(purchaseorders.StatusDelivered))
		default:
			return fmt.Errorf("cannot reach %s from %s", want, cur)
		}
		if err != nil {
			return err
		}
		if err := s.lastTransitionSucceeds(); err != nil {
			return fmt.Errorf("from %s toward %s: %w", cur, want, err)
		}
	}
	return fmt.Errorf("did not reach %s", want)
}

func (s *scenarioState) cancelPO(reason string) error {
	body := purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusCancelled, Note: reason}
	return s.sendRequest(http.MethodPatch, s.poPath("/status"), body)
}

func (s *scenarioState) removePOFile() error {
	return s.sendRequest(http.MethodDelete, s.poPath("/file"), nil)
}

func (s *scenarioState) readPOHistory() error {
	return s.sendRequest(http.MethodGet, s.poPath("/history"), nil)
}

func (s *scenarioState) problemDetailMentions(want string) error {
	var problem struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(s.body, &problem); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, s.body)
	}
	if !strings.Contains(problem.Detail, want) {
		return fmt.Errorf("detail %q does not mention %q", problem.Detail, want)
	}
	return nil
}

func (s *scenarioState) poHistory() ([]purchaseorders.StatusHistoryEntry, error) {
	if err := s.readPOHistory(); err != nil {
		return nil, err
	}
	if s.last.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("history want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	var rows []purchaseorders.StatusHistoryEntry
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("history is empty")
	}
	return rows, nil
}

func (s *scenarioState) historyEndsWith(from, to string) error {
	_, err := s.lastHistoryEntry(from, to)
	return err
}

func (s *scenarioState) historyEndsWithNote(from, to, note string) error {
	last, err := s.lastHistoryEntry(from, to)
	if err != nil {
		return err
	}
	if last.Note == nil || *last.Note != note {
		return fmt.Errorf("want note %q got %+v", note, last.Note)
	}
	return nil
}

func (s *scenarioState) lastHistoryEntry(from, to string) (purchaseorders.StatusHistoryEntry, error) {
	rows, err := s.poHistory()
	if err != nil {
		return purchaseorders.StatusHistoryEntry{}, err
	}
	last := rows[len(rows)-1]
	if last.FromStatus == nil || string(*last.FromStatus) != from || string(last.ToStatus) != to {
		return last, fmt.Errorf("want last entry %s->%s got %+v", from, to, last)
	}
	return last, nil
}

func (s *scenarioState) historyStartsWithCreation(status string) error {
	var rows []purchaseorders.StatusHistoryEntry
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("history is empty")
	}
	first := rows[0]
	if first.FromStatus != nil || string(first.ToStatus) != status {
		return fmt.Errorf("want creation as %s got %+v", status, first)
	}
	return nil
}

func (s *scenarioState) readPO() (purchaseorders.PurchaseOrder, error) {
	var po purchaseorders.PurchaseOrder
	err := json.Unmarshal(s.body, &po)
	return po, err
}

func offeredTargets(ts []purchaseorders.Transition) []string {
	out := make([]string, 0, len(ts))
	for _, t := range ts {
		out = append(out, string(t.To))
	}
	return out
}

func (s *scenarioState) poOffersTransitions(csv string) error {
	po, err := s.readPO()
	if err != nil {
		return err
	}
	want := []string{}
	for _, v := range strings.Split(csv, ",") {
		if v = strings.TrimSpace(v); v != "" {
			want = append(want, v)
		}
	}
	if got := offeredTargets(po.AllowedTransitions); !slices.Equal(got, want) {
		return fmt.Errorf("want transitions %v got %v", want, got)
	}
	return nil
}

func (s *scenarioState) poOffersNoTransitions() error { return s.poOffersTransitions("") }

func (s *scenarioState) onlyCancellationRequiresNote() error {
	po, err := s.readPO()
	if err != nil {
		return err
	}
	for _, t := range po.AllowedTransitions {
		if t.RequiresNote != (t.To == purchaseorders.StatusCancelled) {
			return fmt.Errorf("transition %s requiresNote=%v", t.To, t.RequiresNote)
		}
		if strings.TrimSpace(t.Label) == "" {
			return fmt.Errorf("transition %s has no label", t.To)
		}
	}
	return nil
}

func (s *scenarioState) listRowsOfferTransitions() error {
	if err := s.statusEquals(http.StatusOK); err != nil {
		return err
	}
	var rows []purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("list is empty")
	}
	for _, po := range rows {
		want := offeredTargets(purchaseorders.AllowedTransitions(po.Status))
		if got := offeredTargets(po.AllowedTransitions); !slices.Equal(got, want) {
			return fmt.Errorf("po %d: want %v got %v", po.ID, want, got)
		}
	}
	return nil
}

// appServer builds the production router.
func (s *scenarioState) appServer() *httptest.Server {
	if s.appSrv != nil {
		return s.appSrv
	}
	cfg := app.Config{
		JWTSecret:          "po-acceptance-secret",
		JWTExpiry:          time.Hour,
		RefreshTokenExpiry: 24 * time.Hour,
		CORSAllowedOrigins: []string{"*"},
	}
	s.appSrv = httptest.NewServer(app.NewRouter(cfg, testutil.Pool(s.t), testutil.Store(s.t), nil))
	s.t.Cleanup(s.appSrv.Close)
	return s.appSrv
}

func (s *scenarioState) sendAsRole(method, path string, body any) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(raw)
	}
	srv := s.appServer()
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if s.roleToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.roleToken)
	}
	req.Header.Set("X-Forwarded-For", nextLoginIP())
	res, err := srv.Client().Do(req)
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

func (s *scenarioState) signedInRoleUser(role string) error {
	repo := users.NewRepo(testutil.Pool(s.t), testutil.Store(s.t))
	u, err := repo.Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("atdd_po_%s_%d@example.test", role, time.Now().UnixNano()),
		Name:     "ATDD PO " + role,
		Password: roleUserPassword,
		Role:     users.Role(role),
	}, defaultUserID)
	if err != nil {
		return fmt.Errorf("create %s: %w", role, err)
	}
	s.cleaner.User(u.ID)
	s.roleUsed = true
	s.roleToken = ""
	if err := s.sendAsRole(http.MethodPost, "/api/v1/auth/login",
		auth.LoginRequest{Email: u.Email, Password: roleUserPassword}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusOK {
		return fmt.Errorf("login want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	var resp auth.LoginResponse
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	s.roleToken = resp.Token
	return nil
}

func (s *scenarioState) roleUserCancelsPO(reason string) error {
	body := purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusCancelled, Note: reason}
	return s.sendAsRole(http.MethodPatch, "/api/v1"+s.poPath("/status"), body)
}

// Clear PO rows before users.
// Role users are referenced by PO rows and their history.
func (s *scenarioState) releaseRoleUsers() error {
	if !s.roleUsed {
		return nil
	}
	s.roleUsed = false
	s.roleToken = ""
	return s.reset()
}

func registerStatusSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^the PO has reached "([^"]+)"$`, s.reachPOStatus)
	sc.Step(`^the user cancels the PO with reason "([^"]*)"$`, s.cancelPO)
	sc.Step(`^the user removes the PO file$`, s.removePOFile)
	sc.Step(`^the user reads the PO history$`, s.readPOHistory)
	sc.Step(`^the problem detail mentions "([^"]+)"$`, s.problemDetailMentions)
	sc.Step(`^the PO history ends with "([^"]+)" to "([^"]+)"$`, s.historyEndsWith)
	sc.Step(`^the PO history ends with "([^"]+)" to "([^"]+)" noting "([^"]+)"$`, s.historyEndsWithNote)
	sc.Step(`^the PO history starts with the creation as "([^"]+)"$`, s.historyStartsWithCreation)
	sc.Step(`^the PO offers the transitions "([^"]*)"$`, s.poOffersTransitions)
	sc.Step(`^the PO offers no transitions$`, s.poOffersNoTransitions)
	sc.Step(`^only the cancellation requires a note$`, s.onlyCancellationRequiresNote)
	sc.Step(`^every PO row offers the transitions for its status$`, s.listRowsOfferTransitions)
	sc.Step(`^a signed-in "([^"]+)" user$`, s.signedInRoleUser)
	sc.Step(`^that user cancels the PO with reason "([^"]+)"$`, s.roleUserCancelsPO)
}
