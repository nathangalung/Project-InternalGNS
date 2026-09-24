package acceptance_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// Named blanks, since Gherkin cells trim.
var blanks = map[string]string{
	"spaces":   "   ",
	"a tab":    "\t",
	"newlines": "\n\r\n ",
}

func (s *scenarioState) createClientBlank(kind string) error {
	return s.sendRequest(http.MethodPost, "/clients/",
		clients.CreateClientRequest{Name: blanks[kind], CountryCode: "IDN"})
}

func (s *scenarioState) renameClientBlank(kind string) error {
	return s.sendRequest(http.MethodPut, "/clients/"+strconv.FormatInt(s.clientID, 10),
		clients.UpdateClientRequest{Name: blanks[kind], CountryCode: "IDN", IsActive: true})
}

// postClient creates a client, keeping s.clientID.
func (s *scenarioState) postClient(name string) (int64, error) {
	number, err := s.freeNumber()
	if err != nil {
		return 0, err
	}
	body := clients.CreateClientRequest{Name: name, Number: &number, CountryCode: "IDN"}
	if err := s.sendRequest(http.MethodPost, "/clients/", body); err != nil {
		return 0, err
	}
	if s.last.StatusCode != http.StatusCreated {
		return 0, fmt.Errorf("create client want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	var c clients.Client
	if err := json.Unmarshal(s.body, &c); err != nil {
		return 0, err
	}
	s.cleaner.Client(c.ID)
	return c.ID, nil
}

// The decoy only matches an unescaped wildcard.
func (s *scenarioState) seedWildcardPair(wildcard string) error {
	nonce := time.Now().UnixNano()
	if _, err := s.postClient(fmt.Sprintf("ATDD LIAR X %d", nonce)); err != nil {
		return err
	}
	s.name = fmt.Sprintf("ATDD LIAR %s %d", wildcard, nonce)
	id, err := s.postClient(s.name)
	s.clientID = id
	return err
}

func (s *scenarioState) listByLiteralName() error {
	return s.sendRequest(http.MethodGet, "/clients/?q="+url.QueryEscape(s.name), nil)
}

func (s *scenarioState) listHoldsOnlySeeded() error {
	var rows []clients.Client
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) != 1 || rows[0].ID != s.clientID {
		return fmt.Errorf("want only client %d body=%s", s.clientID, s.body)
	}
	return nil
}

func (s *scenarioState) sendMethod(method, path string) error {
	var body any
	if method == http.MethodPost {
		body = map[string]any{"name": "ATDD Yatim"}
	}
	return s.sendRequest(method, path, body)
}

// otherClientTouchesContact aims at another client's URL.
func (s *scenarioState) otherClientTouchesContact(method string) error {
	other, err := s.postClient(s.uniqueName("ATDD CLIENT ASING"))
	if err != nil {
		return err
	}
	path := "/clients/" + strconv.FormatInt(other, 10) + "/contacts/" + strconv.FormatInt(s.contact.ID, 10)
	var body any
	if method == http.MethodPatch {
		body = map[string]any{"name": "Dibajak", "email": nil, "title": nil}
	}
	return s.sendRequest(method, path, body)
}

// The owner still lists the seeded contact.
func (s *scenarioState) contactListedUnchanged() error {
	if err := s.listContacts(); err != nil {
		return err
	}
	var rows []clients.Contact
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	for _, c := range rows {
		if c.ID == s.contact.ID {
			if c.Name != s.contact.Name || *c.Email != *s.contact.Email || *c.Title != *s.contact.Title {
				return fmt.Errorf("contact changed: %+v", c)
			}
			return nil
		}
	}
	return fmt.Errorf("contact %d no longer listed", s.contact.ID)
}

func (s *scenarioState) noteSummary() error {
	if err := s.readSummary(); err != nil {
		return err
	}
	return json.Unmarshal(s.body, &s.summary)
}

// Deltas against the noted summary.
func (s *scenarioState) summaryGrewBy(n int64) error {
	var now clients.Summary
	if err := json.Unmarshal(s.body, &now); err != nil {
		return err
	}
	got := [3]int64{now.Total - s.summary.Total, now.ActiveCount - s.summary.ActiveCount,
		now.NewThisMonth - s.summary.NewThisMonth}
	if got != [3]int64{n, n, n} {
		return fmt.Errorf("want total, active and new this month +%d, got %v", n, got)
	}
	return nil
}

func registerRuleSteps(sc *godog.ScenarioContext, state *scenarioState) {
	sc.Step(`^the user creates a client named with only (spaces|a tab|newlines)$`, state.createClientBlank)
	sc.Step(`^the user renames the client to only (spaces|a tab|newlines)$`, state.renameClientBlank)
	sc.Step(`^a client named with "([^"]+)" and a decoy without it$`, state.seedWildcardPair)
	sc.Step(`^the user lists clients searching for the literal name$`, state.listByLiteralName)
	sc.Step(`^the client list holds only the client with the wildcard$`, state.listHoldsOnlySeeded)
	sc.Step(`^the user sends (GET|POST) "([^"]+)"$`, state.sendMethod)
	sc.Step(`^another client (PATCH|DELETE)s the contact$`, state.otherClientTouchesContact)
	sc.Step(`^the contact is still listed unchanged$`, state.contactListedUnchanged)
	sc.Step(`^the client summary is noted$`, state.noteSummary)
	sc.Step(`^the summary grew by (\d+) active client(?:s)? this month$`, state.summaryGrewBy)
}
