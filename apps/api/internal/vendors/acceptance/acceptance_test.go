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

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

const defaultUserID int64 = 1

type scenarioState struct {
	t        *testing.T
	srv      *httptest.Server
	last     *http.Response
	body     []byte
	vendorID int64
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
	s.srv = testutil.VendorsServer(s.t, id)
	return nil
}

func (s *scenarioState) uniqueName(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func (s *scenarioState) createVendor() error {
	s.name = s.uniqueName("ATDD VENDOR")
	loc := "Jakarta"
	body := vendors.CreateVendorRequest{Name: s.name, Location: &loc, ContactInfo: json.RawMessage(`{"email":"atdd@vendor.com"}`)}
	if err := s.sendRequest(http.MethodPost, "/vendors/", body); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

func (s *scenarioState) createVendorEmptyName() error {
	body := vendors.CreateVendorRequest{Name: ""}
	return s.sendRequest(http.MethodPost, "/vendors/", body)
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
	s.vendorID = resp.ID
	return nil
}

func (s *scenarioState) seedVendor() error {
	if err := s.createVendor(); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) responseHasVendorID() error { return s.captureID() }

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) readVendor() error {
	return s.sendRequest(http.MethodGet, "/vendors/"+strconv.FormatInt(s.vendorID, 10), nil)
}

func (s *scenarioState) vendorNameMatches() error {
	var v vendors.Vendor
	if err := json.Unmarshal(s.body, &v); err != nil {
		return err
	}
	if v.Name != s.name {
		return fmt.Errorf("want %s got %s", s.name, v.Name)
	}
	return nil
}

func (s *scenarioState) updateVendorName() error {
	s.name = s.uniqueName("ATDD VENDOR UPDATED")
	body := vendors.UpdateVendorRequest{Name: s.name, IsActive: true}
	return s.sendRequest(http.MethodPut, "/vendors/"+strconv.FormatInt(s.vendorID, 10), body)
}

func (s *scenarioState) searchByName() error {
	return s.sendRequest(http.MethodGet, "/vendors/search?q="+url.QueryEscape(s.name), nil)
}

func (s *scenarioState) searchContainsVendor() error {
	var rows []vendors.SearchResult
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	for _, r := range rows {
		if r.VendorID == s.vendorID {
			return nil
		}
	}
	return fmt.Errorf("vendor %d not in search results", s.vendorID)
}

func (s *scenarioState) listItemsForVendor(vendorID int64) error {
	return s.sendRequest(http.MethodGet, "/vendors/"+strconv.FormatInt(vendorID, 10)+"/items", nil)
}

func (s *scenarioState) itemsListAtLeast(min int) error {
	var rows []vendors.ItemByVendor
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
		state := &scenarioState{t: t}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.vendorID = 0
			state.name = ""
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the user creates a vendor$`, state.createVendor)
		sc.Step(`^the user creates a vendor with empty name$`, state.createVendorEmptyName)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the response contains a vendor id$`, state.responseHasVendorID)
		sc.Step(`^an existing vendor$`, state.seedVendor)
		sc.Step(`^the user reads the vendor$`, state.readVendor)
		sc.Step(`^the vendor name matches the seeded value$`, state.vendorNameMatches)
		sc.Step(`^the user updates the vendor name$`, state.updateVendorName)
		sc.Step(`^the vendor name reflects the update$`, state.vendorNameMatches)
		sc.Step(`^the user searches vendors by the seeded name$`, state.searchByName)
		sc.Step(`^the vendor search results contain the seeded vendor$`, state.searchContainsVendor)
		sc.Step(`^the user lists items for vendor (\d+)$`, state.listItemsForVendor)
		sc.Step(`^the items list contains at least (\d+) row(?:s)?$`, state.itemsListAtLeast)
	}
}

func TestVendorsFeatures(t *testing.T) {
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
