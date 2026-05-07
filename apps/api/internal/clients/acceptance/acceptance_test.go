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
	srv      *httptest.Server
	last     *http.Response
	body     []byte
	clientID int64
	name     string
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
	body := clients.CreateClientRequest{Name: s.name, CountryCode: "IDN"}
	if err := s.sendRequest(http.MethodPost, "/clients/", body); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
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

func initScenario(t *testing.T) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.clientID = 0
			state.name = ""
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
	}
}

func TestClientsFeatures(t *testing.T) {
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
	_ = defaultUserID
}
