package acceptance_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"testing"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

type scenarioState struct {
	srv  *httptest.Server
	last *http.Response
	rows []countries.Country
}

func (s *scenarioState) listCountries() error {
	res, err := s.srv.Client().Get(s.srv.URL + "/countries/")
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
		return fmt.Errorf("no countries listed")
	}
	return nil
}

func (s *scenarioState) sortedByName() error {
	if !sort.SliceIsSorted(s.rows, func(i, j int) bool { return s.rows[i].Name < s.rows[j].Name }) {
		return fmt.Errorf("countries are not sorted by name")
	}
	return nil
}

func (s *scenarioState) countryIs(code, name, dial string) error {
	for _, c := range s.rows {
		if c.Code == code {
			if c.Name != name || c.DialCode != dial {
				return fmt.Errorf("country %s is %q %q", code, c.Name, c.DialCode)
			}
			return nil
		}
	}
	return fmt.Errorf("country %s not listed", code)
}

func TestCountriesFeatures(t *testing.T) {
	testutil.RequireDB(t)
	suite := godog.TestSuite{
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			s := &scenarioState{srv: testutil.CountriesServer(t)}
			sc.Step(`^the user lists countries$`, s.listCountries)
			sc.Step(`^the response status is (\d+)$`, s.statusEquals)
			sc.Step(`^the total count header equals the number of countries$`, s.totalMatchesBody)
			sc.Step(`^the countries are sorted by name$`, s.sortedByName)
			sc.Step(`^country "([^"]+)" is "([^"]+)" with dial code "([^"]+)"$`, s.countryIs)
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
