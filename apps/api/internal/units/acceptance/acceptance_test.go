package acceptance_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
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
