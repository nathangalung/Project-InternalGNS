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
	t       *testing.T
	srv     *httptest.Server
	last    *http.Response
	body    []byte
	lastID  int64
	userID  int64
	docNos  [2]string
	pdfPath string
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

func (s *scenarioState) createWithStatus(status string) error {
	req := s.buildCreate("0", 1)
	req.Status = &status
	return s.sendRequest(http.MethodPost, "/quotations/", req)
}

func (s *scenarioState) createZeroQtyQuotation() error {
	req := s.buildCreate("0", 1)
	req.Items[0].Qty = "0"
	return s.sendRequest(http.MethodPost, "/quotations/", req)
}

func (s *scenarioState) noQuotationStored() error {
	var n int64
	err := testutil.Pool(s.t).QueryRow(context.Background(), "SELECT COUNT(*) FROM quotations").Scan(&n)
	if err != nil {
		return err
	}
	if n != 0 {
		return fmt.Errorf("want 0 quotations stored, got %d", n)
	}
	return nil
}

func (s *scenarioState) createUnpricedQuotation() error {
	req := s.buildCreate("0", 1)
	req.Items[0].SellingPrice = "0"
	if err := s.sendRequest(http.MethodPost, "/quotations/", req); err != nil {
		return err
	}
	return s.responseHasID()
}

// Ids reserved for the document-number fixtures.
const (
	docNoClientA int64 = 9100001
	docNoClientB int64 = 9100002
)

func (s *scenarioState) seedNumberedClient(id int64, number string, seq int) error {
	pool := testutil.Pool(s.t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO company_client (id, number, name, country_code, created_by, updated_by)
		 VALUES ($1, $2, $3, 'IDN', 1, 1)`, id, number, "Fixture "+number); err != nil {
		return err
	}
	if seq > 0 {
		if _, err := pool.Exec(ctx,
			`INSERT INTO doc_sequences (doc_type, company_id, year, last_seq, updated_at)
			 VALUES ('Q', $1, EXTRACT(YEAR FROM NOW())::INT, $2, NOW())`, id, seq); err != nil {
			return err
		}
	}
	return nil
}

func (s *scenarioState) dropNumberedClients() {
	pool := testutil.Pool(s.t)
	ctx := context.Background()
	for _, id := range []int64{docNoClientA, docNoClientB} {
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_items WHERE quotation_id IN
			(SELECT id FROM quotations WHERE company_client_id = $1)`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_status_history WHERE quotation_id IN
			(SELECT id FROM quotations WHERE company_client_id = $1)`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotations WHERE company_client_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM doc_sequences WHERE company_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM company_client WHERE id = $1`, id)
	}
}

func (s *scenarioState) quotationNoFor(client int64) (string, error) {
	req := s.buildCreate("0", 1)
	req.CompanyClientID = client
	if err := s.sendRequest(http.MethodPost, "/quotations/", req); err != nil {
		return "", err
	}
	if err := s.responseHasID(); err != nil {
		return "", err
	}
	if err := s.readDetail(); err != nil {
		return "", err
	}
	var d quotations.QuotationDetail
	if err := json.Unmarshal(s.body, &d); err != nil {
		return "", err
	}
	return d.QuotationNo, nil
}

func (s *scenarioState) createForBothClients() error {
	a, err := s.quotationNoFor(docNoClientA)
	if err != nil {
		return err
	}
	b, err := s.quotationNoFor(docNoClientB)
	if err != nil {
		return err
	}
	s.docNos = [2]string{a, b}
	return nil
}

func (s *scenarioState) docNosDiffer() error {
	if s.docNos[0] == s.docNos[1] {
		return fmt.Errorf("both clients got quotation number %s", s.docNos[0])
	}
	return nil
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
		sc.Step(`^the user creates a quotation with status "([^"]+)"$`, state.createWithStatus)
		sc.Step(`^the user creates a quotation with a zero quantity product line$`, state.createZeroQtyQuotation)
		sc.Step(`^no quotation was stored$`, state.noQuotationStored)
		sc.Step(`^a client numbered "([^"]+)" already on quotation sequence (\d+)$`, func(number string, seq int) error {
			state.dropNumberedClients()
			return state.seedNumberedClient(docNoClientA, number, seq)
		})
		sc.Step(`^a client numbered "([^"]+)"$`, func(number string) error {
			return state.seedNumberedClient(docNoClientB, number, 0)
		})
		sc.Step(`^the user creates one quotation for each of those clients$`, state.createForBothClients)
		sc.Step(`^the two quotation numbers differ$`, state.docNosDiffer)
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
		sc.Step(`^a draft quotation with a discount, shipping and an unpriced line$`, state.createPricedQuotation)
		sc.Step(`^the user downloads the quotation PDF$`, state.downloadPDF)
		sc.Step(`^the PDF prints the stored totals, the offered item and No Offer$`, state.pdfPrintsStoredTotals)
		sc.Step(`^the PDF has (\d+) page$`, state.pdfPages)
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
