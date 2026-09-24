package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const defaultUserID int64 = 1

type scenarioState struct {
	t        *testing.T
	cleaner  *testutil.Cleaner
	srv      *httptest.Server
	last     *http.Response
	body     []byte
	clientID int64
	name     string
	contact  clients.Contact
	number   string
	summary  clients.Summary
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

func (s *scenarioState) authenticatedUser(id int64) error {
	s.srv = testutil.ClientsServer(s.t, id)
	return nil
}

func (s *scenarioState) uniqueName(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func (s *scenarioState) createClient() error {
	s.name = s.uniqueName("ATDD CLIENT")
	number, err := s.freeNumber()
	if err != nil {
		return err
	}
	s.number = number
	body := clients.CreateClientRequest{Name: s.name, Number: &number, CountryCode: "IDN"}
	if err := s.sendRequest(http.MethodPost, "/clients/", body); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

// freeNumber picks an unused four digit client number.
func (s *scenarioState) freeNumber() (string, error) {
	var n string
	err := testutil.Pool(s.t).QueryRow(context.Background(), `
		SELECT LPAD(g::text, 4, '0') FROM generate_series(1, 9999) AS g
		WHERE NOT EXISTS (
		  SELECT 1 FROM company_client WHERE number = LPAD(g::text, 4, '0'))
		ORDER BY random() LIMIT 1`).Scan(&n)
	if err != nil {
		return "", fmt.Errorf("pick client number: %w", err)
	}
	return n, nil
}

func (s *scenarioState) createClientEmptyName() error {
	body := clients.CreateClientRequest{Name: "", CountryCode: "IDN"}
	return s.sendRequest(http.MethodPost, "/clients/", body)
}

func (s *scenarioState) captureID() error {
	var resp struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	if resp.ID == 0 {
		return fmt.Errorf("missing id body=%s", s.body)
	}
	s.clientID = resp.ID
	s.cleaner.Client(resp.ID)
	return nil
}

func (s *scenarioState) seedClient() error {
	if err := s.createClient(); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) responseHasID() error { return s.captureID() }

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) readClient() error {
	return s.sendRequest(http.MethodGet, "/clients/"+strconv.FormatInt(s.clientID, 10), nil)
}

func (s *scenarioState) clientNameMatches() error {
	var c clients.Client
	if err := json.Unmarshal(s.body, &c); err != nil {
		return err
	}
	if c.Name != s.name {
		return fmt.Errorf("want %s got %s", s.name, c.Name)
	}
	return nil
}

func (s *scenarioState) updateClientName() error {
	s.name = s.uniqueName("ATDD CLIENT UPDATED")
	body := clients.UpdateClientRequest{Name: s.name, CountryCode: "IDN", IsActive: true}
	return s.sendRequest(http.MethodPut, "/clients/"+strconv.FormatInt(s.clientID, 10), body)
}

func (s *scenarioState) searchByName() error {
	return s.sendRequest(http.MethodGet, "/clients/search?q="+url.QueryEscape(s.name), nil)
}

func (s *scenarioState) searchContainsClient() error {
	var rows []clients.SearchResult
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	for _, r := range rows {
		if r.CompanyID == s.clientID {
			return nil
		}
	}
	return fmt.Errorf("client %d not in search results", s.clientID)
}

func (s *scenarioState) addContact(name string) error {
	body := clients.CreateContactRequest{Name: name, CountryCode: "IDN"}
	return s.sendRequest(http.MethodPost, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts", body)
}

func (s *scenarioState) addContactEmptyName() error {
	body := clients.CreateContactRequest{Name: "", CountryCode: "IDN"}
	return s.sendRequest(http.MethodPost, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts", body)
}

func (s *scenarioState) listContacts() error {
	return s.sendRequest(http.MethodGet, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts", nil)
}

func (s *scenarioState) contactsAtLeast(min int) error {
	var rows []clients.Contact
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) < min {
		return fmt.Errorf("want >=%d got %d", min, len(rows))
	}
	return nil
}

func (s *scenarioState) readSummary() error {
	return s.sendRequest(http.MethodGet, "/clients/summary", nil)
}

func (s *scenarioState) summaryTotalAtLeast(min int64) error {
	var sum clients.Summary
	if err := json.Unmarshal(s.body, &sum); err != nil {
		return err
	}
	if sum.Total < min {
		return fmt.Errorf("want >=%d got %d", min, sum.Total)
	}
	return nil
}

// Contact steps for MD-06, MD-07, MD-08.
func (s *scenarioState) contactPath() string {
	return "/clients/" + strconv.FormatInt(s.clientID, 10) + "/contacts/" + strconv.FormatInt(s.contact.ID, 10)
}

func (s *scenarioState) seedContactWithEmail() error {
	body := map[string]any{
		"name":  "Kontak ATDD",
		"email": fmt.Sprintf("atdd.%d@uji.local", time.Now().UnixNano()),
		"title": "Purchasing",
	}
	if err := s.sendRequest(http.MethodPost, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts", body); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed contact want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return json.Unmarshal(s.body, &s.contact)
}

func (s *scenarioState) clearContactEmailAndTitle() error {
	return s.sendRequest(http.MethodPatch, s.contactPath(),
		map[string]any{"name": s.contact.Name, "email": "", "title": nil})
}

func (s *scenarioState) contactHasNoEmailOrTitle() error {
	var c clients.Contact
	if err := json.Unmarshal(s.body, &c); err != nil {
		return err
	}
	if c.Email != nil || c.Title != nil {
		return fmt.Errorf("want email and title cleared, got email=%v title=%v", c.Email, c.Title)
	}
	return nil
}

func (s *scenarioState) deleteContact() error {
	return s.sendRequest(http.MethodDelete, s.contactPath(), nil)
}

func (s *scenarioState) renameContact() error {
	return s.sendRequest(http.MethodPatch, s.contactPath(), map[string]any{"name": "Nama Baru"})
}

func (s *scenarioState) otherClientReusesEmail() error {
	email := *s.contact.Email
	if err := s.seedClient(); err != nil {
		return err
	}
	return s.sendRequest(http.MethodPost, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts",
		map[string]any{"name": "Pemilik Baru", "email": email})
}

// attachForeignLogo points at another client's upload.
func (s *scenarioState) attachForeignLogo() error {
	key := "clients/" + strconv.FormatInt(s.clientID+1, 10) + "/logo.png"
	return s.sendRequest(http.MethodPatch, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/logo",
		clients.UpdateLogoRequest{ObjectKey: key})
}

// Client number steps.
func (s *scenarioState) createClientNumbered(number *string) error {
	s.name = s.uniqueName("ATDD CLIENT NUMBER")
	body := map[string]any{"name": s.name, "countryCode": "IDN"}
	if number != nil {
		body["number"] = *number
	}
	if err := s.sendRequest(http.MethodPost, "/clients/", body); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

func (s *scenarioState) createClientDuplicateNumber() error {
	return s.createClientNumbered(&s.number)
}

func (s *scenarioState) assignedNumber() error {
	var c clients.Client
	if err := json.Unmarshal(s.body, &c); err != nil {
		return err
	}
	if c.Number == nil || !fourDigits.MatchString(*c.Number) {
		return fmt.Errorf("want a four digit number body=%s", s.body)
	}
	return nil
}

func (s *scenarioState) numberErrorReads(want string) error {
	var problem struct {
		Fields map[string]string `json:"fields"`
	}
	if err := json.Unmarshal(s.body, &problem); err != nil {
		return err
	}
	if got := problem.Fields["number"]; got != want {
		return fmt.Errorf("want fields.number %q got %q body=%s", want, got, s.body)
	}
	return nil
}

// quoteClient commits a quotation.
func (s *scenarioState) quoteClient() error {
	pool := testutil.Pool(s.t)
	ctx := context.Background()
	var id int64
	err := pool.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        created_by, updated_by)
		VALUES ($1, $2, $3, 0, 0, 0, 0, 1, 1) RETURNING id`,
		s.uniqueName("Q-ATDD-NUM"), s.clientID, s.name).Scan(&id)
	if err != nil {
		return fmt.Errorf("insert quotation: %w", err)
	}
	// Runs before the Cleaner drops the client.
	s.t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_status_history WHERE quotation_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotations WHERE id = $1`, id)
	})
	return nil
}

func (s *scenarioState) changeNumber() error {
	number, err := s.freeNumber()
	if err != nil {
		return err
	}
	body := map[string]any{"name": s.name, "countryCode": "IDN", "isActive": true, "number": number}
	return s.sendRequest(http.MethodPut, "/clients/"+strconv.FormatInt(s.clientID, 10), body)
}

var fourDigits = regexp.MustCompile(`^[0-9]{4}$`)

func initScenario(t *testing.T, cleaner *testutil.Cleaner) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t, cleaner: cleaner}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.clientID = 0
			state.name = ""
			state.contact = clients.Contact{}
			state.number = ""
			state.summary = clients.Summary{}
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the user creates a client$`, state.createClient)
		sc.Step(`^the user creates a client with empty name$`, state.createClientEmptyName)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the response contains a client id$`, state.responseHasID)
		sc.Step(`^an existing client$`, state.seedClient)
		sc.Step(`^the user reads the client$`, state.readClient)
		sc.Step(`^the client name matches the seeded value$`, state.clientNameMatches)
		sc.Step(`^the user updates the client name$`, state.updateClientName)
		sc.Step(`^the client name reflects the update$`, state.clientNameMatches)
		sc.Step(`^the user searches clients by the seeded name$`, state.searchByName)
		sc.Step(`^the search results contain the seeded client$`, state.searchContainsClient)
		sc.Step(`^the user adds a contact named "([^"]+)"$`, state.addContact)
		sc.Step(`^the user adds a contact with empty name$`, state.addContactEmptyName)
		sc.Step(`^the user lists client contacts$`, state.listContacts)
		sc.Step(`^the contact list contains at least (\d+) row(?:s)?$`, state.contactsAtLeast)
		sc.Step(`^the user reads client summary$`, state.readSummary)
		sc.Step(`^the client summary total is at least (\d+)$`, state.summaryTotalAtLeast)
		sc.Step(`^the client has a contact with an email and a title$`, state.seedContactWithEmail)
		sc.Step(`^the user clears the contact email and title$`, state.clearContactEmailAndTitle)
		sc.Step(`^the contact has no email and no title$`, state.contactHasNoEmailOrTitle)
		sc.Step(`^the user deletes the contact$`, state.deleteContact)
		sc.Step(`^the user renames the contact$`, state.renameContact)
		sc.Step(`^another client adds a contact with the same email$`, state.otherClientReusesEmail)
		sc.Step(`^the user attaches a logo stored under another client$`, state.attachForeignLogo)
		sc.Step(`^the user creates a client without a number$`, func() error { return state.createClientNumbered(nil) })
		sc.Step(`^the user creates a client with number "([^"]*)"$`, func(n string) error { return state.createClientNumbered(&n) })
		sc.Step(`^the user creates a client with the existing client's number$`, state.createClientDuplicateNumber)
		sc.Step(`^the response assigns a four digit client number$`, state.assignedNumber)
		sc.Step(`^the client number error reads "([^"]+)"$`, state.numberErrorReads)
		sc.Step(`^a quotation references the client$`, state.quoteClient)
		sc.Step(`^the user changes the client number$`, state.changeNumber)
		registerRuleSteps(sc, state)
	}
}

func TestClientsFeatures(t *testing.T) {
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
	_ = defaultUserID
}
