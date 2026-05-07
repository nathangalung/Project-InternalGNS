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
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	defaultUserID int64 = 1
	defaultUnit   int16 = 19
	seedVendorID  int64 = 1
)

type scenarioState struct {
	t      *testing.T
	srv    *httptest.Server
	last   *http.Response
	body   []byte
	itemID int64
	name   string
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
	s.srv = testutil.ItemsServer(s.t, id)
	return nil
}

func (s *scenarioState) uniqueName(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func (s *scenarioState) createItem() error {
	s.name = s.uniqueName("ATDD ITEM")
	unit := defaultUnit
	body := items.CreateItemRequest{Name: s.name, DefaultUnitID: &unit}
	if err := s.sendRequest(http.MethodPost, "/items/", body); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

func (s *scenarioState) createItemEmptyName() error {
	body := items.CreateItemRequest{Name: ""}
	return s.sendRequest(http.MethodPost, "/items/", body)
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
	s.itemID = resp.ID
	return nil
}

func (s *scenarioState) seedItem() error {
	if err := s.createItem(); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) responseHasItemID() error { return s.captureID() }

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) readItem() error {
	return s.sendRequest(http.MethodGet, "/items/"+strconv.FormatInt(s.itemID, 10), nil)
}

func (s *scenarioState) itemNameMatches() error {
	var it items.Item
	if err := json.Unmarshal(s.body, &it); err != nil {
		return err
	}
	if it.Name != s.name {
		return fmt.Errorf("want %s got %s", s.name, it.Name)
	}
	return nil
}

func (s *scenarioState) updateItemName() error {
	s.name = s.uniqueName("ATDD ITEM UPDATED")
	unit := defaultUnit
	body := items.UpdateItemRequest{Name: s.name, DefaultUnitID: &unit, IsActive: true}
	return s.sendRequest(http.MethodPut, "/items/"+strconv.FormatInt(s.itemID, 10), body)
}

func (s *scenarioState) searchByName() error {
	return s.sendRequest(http.MethodGet, "/items/search?q="+url.QueryEscape(s.name), nil)
}

func (s *scenarioState) searchContainsItem() error {
	var rows []items.SearchResult
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	for _, r := range rows {
		if r.ID == s.itemID {
			return nil
		}
	}
	return fmt.Errorf("item %d not in search results", s.itemID)
}

func (s *scenarioState) matchRequestSeeded() error {
	body := items.MatchRequest{ReqText: strings.ToLower(s.name), Limit: 5}
	return s.sendRequest(http.MethodPost, "/items/match-request", body)
}

func (s *scenarioState) matchRequestEmpty() error {
	body := items.MatchRequest{ReqText: "", Limit: 5}
	return s.sendRequest(http.MethodPost, "/items/match-request", body)
}

func (s *scenarioState) matchAtLeast(min int) error {
	var rows []items.MatchResult
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) < min {
		return fmt.Errorf("want >=%d got %d", min, len(rows))
	}
	return nil
}

func (s *scenarioState) linkVendor(vendorID int64) error {
	cost := "100000"
	sku := "ATDD-SKU"
	body := items.AddVendorToItemRequest{VendorID: vendorID, VendorSKU: &sku, CostPrice: &cost}
	return s.sendRequest(http.MethodPost, "/items/"+strconv.FormatInt(s.itemID, 10)+"/vendors", body)
}

func (s *scenarioState) listVendorsForItem() error {
	return s.sendRequest(http.MethodGet, "/items/"+strconv.FormatInt(s.itemID, 10)+"/vendors", nil)
}

func (s *scenarioState) vendorListAtLeast(min int) error {
	var rows []items.VendorForItem
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
			state.itemID = 0
			state.name = ""
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the user creates an item$`, state.createItem)
		sc.Step(`^the user creates an item with empty name$`, state.createItemEmptyName)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the response contains an item id$`, state.responseHasItemID)
		sc.Step(`^an existing item$`, state.seedItem)
		sc.Step(`^the user reads the item$`, state.readItem)
		sc.Step(`^the item name matches the seeded value$`, state.itemNameMatches)
		sc.Step(`^the user updates the item name$`, state.updateItemName)
		sc.Step(`^the item name reflects the update$`, state.itemNameMatches)
		sc.Step(`^the user searches items by the seeded name$`, state.searchByName)
		sc.Step(`^the item search results contain the seeded item$`, state.searchContainsItem)
		sc.Step(`^the user matches a request that mentions the seeded name$`, state.matchRequestSeeded)
		sc.Step(`^the user matches a request with empty text$`, state.matchRequestEmpty)
		sc.Step(`^the match results contain at least (\d+) candidate(?:s)?$`, state.matchAtLeast)
		sc.Step(`^the user links vendor (\d+) to the item$`, state.linkVendor)
		sc.Step(`^the user lists vendors for the item$`, state.listVendorsForItem)
		sc.Step(`^the vendor list contains at least (\d+) row(?:s)?$`, state.vendorListAtLeast)
	}
}

func TestItemsFeatures(t *testing.T) {
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
	_ = seedVendorID
}
