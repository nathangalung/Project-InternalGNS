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
	"testing"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	defaultUserID  int64 = 1
	defaultCompany int64 = 1
	defaultUnit    int16 = 19
)

type scenarioState struct {
	t      *testing.T
	srv    *httptest.Server
	last   *http.Response
	body   []byte
	lastID int64
	userID int64
}

func (s *scenarioState) reset() error {
	pool := testutil.Pool(s.t)
	return testutil.ResetQuotationDomain(context.Background(), pool)
}

func (s *scenarioState) sendRequest(method, path string, body any) error {
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

func (s *scenarioState) buildCreate(discount string, lines int) quotations.CreateRequest {
	items := make([]quotations.CreateItem, 0, lines)
	for i := 0; i < lines; i++ {
		items = append(items, quotations.CreateItem{
			RequestedName: fmt.Sprintf("ITEM %d", i+1),
			Qty:           "1",
			UnitID:        defaultUnit,
			SellingPrice:  "10000",
		})
	}
	return quotations.CreateRequest{
		CompanyClientID: defaultCompany,
		DiscountPct:     discount,
		Items:           items,
	}
}

func (s *scenarioState) authenticatedUser(id int64) error {
	s.userID = id
	s.srv = testutil.QuotationServer(s.t, id)
	return nil
}

func (s *scenarioState) emptyDomain() error { return s.reset() }

func (s *scenarioState) createQuotation(discount string, lines int) error {
	return s.sendRequest(http.MethodPost, "/quotations/", s.buildCreate(discount, lines))
}

func (s *scenarioState) createWithoutItems() error {
	return s.sendRequest(http.MethodPost, "/quotations/", s.buildCreate("0", 0))
}

func (s *scenarioState) createUnpricedQuotation() error {
	req := s.buildCreate("0", 1)
	req.Items[0].SellingPrice = "0"
	if err := s.sendRequest(http.MethodPost, "/quotations/", req); err != nil {
		return err
	}
	return s.responseHasID()
}

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, string(s.body))
	}
	return nil
}

func (s *scenarioState) responseHasID() error {
	var resp map[string]int64
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	if resp["id"] == 0 {
		return fmt.Errorf("missing id in body: %s", s.body)
	}
	s.lastID = resp["id"]
	return nil
}

func (s *scenarioState) seedDraft() error {
	if err := s.createQuotation("0", 1); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed draft want 201 got %d", s.last.StatusCode)
	}
	return s.responseHasID()
}

func (s *scenarioState) sendAction() error {
	return s.sendRequest(http.MethodPost, "/quotations/"+strconv.FormatInt(s.lastID, 10)+"/send", nil)
}

func (s *scenarioState) readDetail() error {
	return s.sendRequest(http.MethodGet, "/quotations/"+strconv.FormatInt(s.lastID, 10), nil)
}

func (s *scenarioState) detailStatusEquals(want string) error {
	var d quotations.QuotationDetail
	if err := json.Unmarshal(s.body, &d); err != nil {
		return err
	}
	if d.Status != want {
		return fmt.Errorf("want %s got %s", want, d.Status)
	}
	return nil
}

func (s *scenarioState) walkPath(path string) error {
	for _, step := range strings.Split(path, ",") {
		if err := s.transitionTo(strings.TrimSpace(step)); err != nil {
			return err
		}
		if s.last.StatusCode != http.StatusNoContent {
			return fmt.Errorf("step %s wanted 204 got %d body=%s", step, s.last.StatusCode, s.body)
		}
	}
	return nil
}

func (s *scenarioState) transitionTo(target string) error {
	body := quotations.ChangeStatusRequest{Status: target}
	return s.sendRequest(http.MethodPatch, "/quotations/"+strconv.FormatInt(s.lastID, 10)+"/status", body)
}

func (s *scenarioState) tryTransition(target string) error {
	return s.transitionTo(target)
}

func (s *scenarioState) listFilteredByStatus(status string) error {
	return s.sendRequest(http.MethodGet, "/quotations/?status="+status, nil)
}

func (s *scenarioState) listAtLeast(min int) error {
	var rows []quotations.ListRow
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) < min {
		return fmt.Errorf("want >=%d got %d", min, len(rows))
	}
	return nil
}

func initScenario(t *testing.T) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t, userID: defaultUserID}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.lastID = 0
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the quotation domain is empty$`, state.emptyDomain)
		sc.Step(`^the user creates a quotation with discount (\d+) percent and (\d+) product line(?:s)?$`, func(d string, lines int) error {
			return state.createQuotation(d, lines)
		})
		sc.Step(`^the user creates a quotation with no items$`, state.createWithoutItems)
		sc.Step(`^the user creates a quotation with an unpriced product line$`, state.createUnpricedQuotation)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the response contains a quotation id$`, state.responseHasID)
		sc.Step(`^an existing draft quotation$`, state.seedDraft)
		sc.Step(`^the user sends the quotation$`, state.sendAction)
		sc.Step(`^the user reads the quotation$`, state.readDetail)
		sc.Step(`^the quotation status is "([^"]+)"$`, state.detailStatusEquals)
		sc.Step(`^the user transitions the quotation through "([^"]+)"$`, state.walkPath)
		sc.Step(`^every transition succeeds$`, func() error {
			if state.last.StatusCode != http.StatusNoContent {
				return fmt.Errorf("last not 204: %d", state.last.StatusCode)
			}
			return nil
		})
		sc.Step(`^the user tries to transition the quotation to "([^"]+)"$`, state.tryTransition)
		sc.Step(`^the user lists quotations filtered by status "([^"]+)"$`, state.listFilteredByStatus)
		sc.Step(`^the list contains at least (\d+) quotation(?:s)?$`, state.listAtLeast)
	}
}

func TestQuotationFeatures(t *testing.T) {
	testutil.RequireDB(t)
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(t),
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
