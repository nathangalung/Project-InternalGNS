package acceptance_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// Named whitespace-only names.
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

// postClient keeps s.clientID.
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

// Decoy matches unescaped wildcards.
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

// Contact via foreign client.
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

// Owner still lists contact.
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

// Contact field steps.
func (s *scenarioState) addContactWith(field, value string) error {
	return s.sendRequest(http.MethodPost, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts",
		map[string]any{"name": "Kontak ATDD", field: value})
}

func (s *scenarioState) setContactPhone(phone string) error {
	return s.sendRequest(http.MethodPatch, s.contactPath(),
		map[string]any{"name": s.contact.Name, "phone": phone})
}

func (s *scenarioState) fieldErrorReads(field, want string) error {
	var p struct {
		Fields map[string]string `json:"fields"`
	}
	if err := json.Unmarshal(s.body, &p); err != nil {
		return err
	}
	if got := p.Fields[field]; got != want {
		return fmt.Errorf("field %s: want %q got %q body=%s", field, want, got, s.body)
	}
	return nil
}

func (s *scenarioState) noContacts() error {
	var rows []clients.Contact
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) != 0 {
		return fmt.Errorf("want no contacts, got %d", len(rows))
	}
	return nil
}

func registerRuleSteps(sc *godog.ScenarioContext, state *scenarioState) {
	sc.Step(`^the user adds a contact with (phone|email) "([^"]*)"$`, state.addContactWith)
	sc.Step(`^the user sets the contact phone to "([^"]*)"$`, state.setContactPhone)
	sc.Step(`^the (phone|email) field error reads "([^"]+)"$`, state.fieldErrorReads)
	sc.Step(`^the client has no contacts$`, state.noContacts)
	sc.Step(`^the user creates a client named with only (spaces|a tab|newlines)$`, state.createClientBlank)
	sc.Step(`^the user renames the client to only (spaces|a tab|newlines)$`, state.renameClientBlank)
	sc.Step(`^a client named with "([^"]+)" and a decoy without it$`, state.seedWildcardPair)
	sc.Step(`^the user lists clients searching for the literal name$`, state.listByLiteralName)
	sc.Step(`^the client list holds only the client with the wildcard$`, state.listHoldsOnlySeeded)
	sc.Step(`^the user sends (GET|POST) "([^"]+)"$`, state.sendMethod)
	sc.Step(`^another client (PATCH|DELETE)s the contact$`, state.otherClientTouchesContact)
	sc.Step(`^the contact is still listed unchanged$`, state.contactListedUnchanged)
	sc.Step(`^the client summary is noted$`, state.noteSummary)
	sc.Step(`^the user sends the (client create|client update|contact create|contact update) email wrapped in (spaces|a tab|newlines)$`, state.sendPaddedEmail)
	sc.Step(`^the user reads the (client create|client update|contact create|contact update) back$`, state.readBack)
	sc.Step(`^the returned email is the bare address$`, state.returnedEmailIsBare)
	sc.Step(`^the summary grew by (\d+) active client(?:s)? this month$`, state.summaryGrewBy)
}

// Padded email steps.
func (s *scenarioState) sendPaddedEmail(target, padding string) error {
	s.email = fmt.Sprintf("atdd.pad.%d@uji.local", time.Now().UnixNano())
	padded := blanks[padding] + s.email + blanks[padding]
	switch target {
	case "client create":
		number, err := s.freeNumber()
		if err != nil {
			return err
		}
		s.name = s.uniqueName("ATDD CLIENT PAD")
		body := clients.CreateClientRequest{Name: s.name, Number: &number, CountryCode: "IDN", Email: &padded}
		if err := s.sendRequest(http.MethodPost, "/clients/", body); err != nil {
			return err
		}
		if s.last.StatusCode == http.StatusCreated {
			if err := s.captureID(); err != nil {
				return err
			}
		}
		return nil
	case "client update":
		return s.sendRequest(http.MethodPut, "/clients/"+strconv.FormatInt(s.clientID, 10),
			clients.UpdateClientRequest{Name: s.name, CountryCode: "IDN", IsActive: true, Email: &padded})
	case "contact create":
		return s.sendRequest(http.MethodPost, "/clients/"+strconv.FormatInt(s.clientID, 10)+"/contacts",
			map[string]any{"name": "Kontak Pad", "email": padded})
	default:
		return s.sendRequest(http.MethodPatch, s.contactPath(),
			map[string]any{"name": s.contact.Name, "email": padded})
	}
}

// Reads the stored row.
func (s *scenarioState) readBack(target string) error {
	if target == "client create" || target == "client update" {
		return s.readClient()
	}
	if err := s.listContacts(); err != nil {
		return err
	}
	var rows []clients.Contact
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	for _, c := range rows {
		if c.Email != nil && strings.TrimSpace(*c.Email) == s.email {
			raw, err := json.Marshal(c)
			s.body = raw
			return err
		}
	}
	return fmt.Errorf("no contact holds %s body=%s", s.email, s.body)
}

func (s *scenarioState) returnedEmailIsBare() error {
	var got struct {
		Email *string `json:"email"`
	}
	if err := json.Unmarshal(s.body, &got); err != nil {
		return err
	}
	if got.Email == nil || *got.Email != s.email {
		return fmt.Errorf("want email %q body=%s", s.email, s.body)
	}
	return nil
}
