package acceptance_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

type scenarioState struct {
	srv  *httptest.Server
	last *http.Response
	rows []units.Unit
}

func (s *scenarioState) listUnits() error {
	res, err := s.srv.Client().Get(s.srv.URL + "/units/")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	s.last = res
	s.rows = nil
	if res.StatusCode == http.StatusOK {
		return json.Unmarshal(raw, &s.rows)
	}
	return nil
}

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d", want, s.last.StatusCode)
	}
	return nil
}

func (s *scenarioState) totalMatchesBody() error {
	if got := s.last.Header.Get("X-Total-Count"); got != strconv.Itoa(len(s.rows)) {
		return fmt.Errorf("X-Total-Count %q for %d rows", got, len(s.rows))
	}
	if len(s.rows) == 0 {
		return fmt.Errorf("no units listed")
	}
	return nil
}

func (s *scenarioState) orderedByID() error {
	for i := 1; i < len(s.rows); i++ {
		if s.rows[i-1].ID >= s.rows[i].ID {
			return fmt.Errorf("unit %d listed before %d", s.rows[i-1].ID, s.rows[i].ID)
		}
	}
	return nil
}

func (s *scenarioState) everyUnitComplete() error {
	for _, u := range s.rows {
		if u.Name == nil || *u.Name == "" || u.CoretaxCode == nil || *u.CoretaxCode == "" {
			return fmt.Errorf("unit %s lacks a name or Coretax code", u.Code)
		}
	}
	return nil
}

func (s *scenarioState) find(code string) (units.Unit, error) {
	for _, u := range s.rows {
		if u.Code == code {
			return u, nil
		}
	}
	return units.Unit{}, fmt.Errorf("unit %s not listed", code)
}

func (s *scenarioState) unitIs(code, name, coretax string) error {
	u, err := s.find(code)
	if err != nil {
		return err
	}
	if *u.Name != name || *u.CoretaxCode != coretax {
		return fmt.Errorf("unit %s is %q %q", code, *u.Name, *u.CoretaxCode)
	}
	return nil
}

func (s *scenarioState) unitListed(code string) error {
	_, err := s.find(code)
	return err
}

func (s *scenarioState) unitNotListed(code string) error {
	if _, err := s.find(code); err == nil {
		return fmt.Errorf("unit %s is listed", code)
	}
	return nil
}

func (s *scenarioState) unitAlsoWritten(code, alias string) error {
	u, err := s.find(code)
	if err != nil {
		return err
	}
	if !slices.Contains(u.Aliases, alias) {
		return fmt.Errorf("unit %s aliases %v lack %s", code, u.Aliases, alias)
	}
	return nil
}

func (s *scenarioState) noAliasIsACode() error {
	codes := map[string]bool{}
	for _, u := range s.rows {
		codes[strings.ToUpper(u.Code)] = true
	}
	seen := map[string]string{}
	for _, u := range s.rows {
		for _, a := range u.Aliases {
			if codes[a] {
				return fmt.Errorf("alias %s of %s is a unit code", a, u.Code)
			}
			if other, dup := seen[a]; dup {
				return fmt.Errorf("alias %s names %s and %s", a, other, u.Code)
			}
			seen[a] = u.Code
		}
	}
	return nil
}

func TestUnitsFeatures(t *testing.T) {
	testutil.RequireDB(t)
	suite := godog.TestSuite{
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			s := &scenarioState{srv: testutil.UnitsServer(t)}
			sc.Step(`^the user lists units$`, s.listUnits)
			sc.Step(`^the response status is (\d+)$`, s.statusEquals)
			sc.Step(`^the total count header equals the number of units$`, s.totalMatchesBody)
			sc.Step(`^the units are ordered by id$`, s.orderedByID)
			sc.Step(`^every unit has a name and a Coretax code$`, s.everyUnitComplete)
			sc.Step(`^unit "([^"]+)" is "([^"]+)" with Coretax code "([^"]+)"$`, s.unitIs)
			sc.Step(`^unit "([^"]+)" is listed$`, s.unitListed)
			sc.Step(`^unit "([^"]+)" is not listed$`, s.unitNotListed)
			sc.Step(`^unit "([^"]+)" is also written "([^"]+)"$`, s.unitAlsoWritten)
			sc.Step(`^no alias equals a unit code$`, s.noAliasIsACode)
		},
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
