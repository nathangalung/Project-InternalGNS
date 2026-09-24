package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
)

// Named blanks, since Gherkin cells trim.
var blanks = map[string]string{
	"spaces":   "   ",
	"a tab":    "\t",
	"newlines": "\n\r\n ",
}

func (s *scenarioState) renameItemBlank(kind string) error {
	return s.sendRequest(http.MethodPut, "/items/"+strconv.FormatInt(s.itemID, 10),
		items.UpdateItemRequest{Name: blanks[kind], IsActive: true})
}

// attachForeignImage points at another item's upload.
func (s *scenarioState) attachForeignImage() error {
	key := fmt.Sprintf("items/%d/foto.jpg", s.itemID+1)
	return s.sendRequest(http.MethodPatch, "/items/"+strconv.FormatInt(s.itemID, 10)+"/image",
		items.UpdateImageRequest{ObjectKey: key})
}

// katalog tracks one paged search.
type katalog struct {
	token string
	want  map[int64]bool
	seen  map[int64]bool
}

func (k *katalog) seed(s *scenarioState, n int) error {
	k.token = fmt.Sprintf("Katalogix%d", time.Now().UnixNano())
	k.want = map[int64]bool{}
	for i := range n {
		body := items.CreateItemRequest{Name: fmt.Sprintf("%s Part %d", k.token, i)}
		if err := s.sendRequest(http.MethodPost, "/items/", body); err != nil {
			return err
		}
		if s.last.StatusCode != http.StatusCreated {
			return fmt.Errorf("seed want 201 got %d body=%s", s.last.StatusCode, s.body)
		}
		if err := s.captureID(); err != nil {
			return err
		}
		k.want[s.itemID] = true
	}
	return nil
}

func (k *katalog) search(s *scenarioState, query string) error {
	return s.sendRequest(http.MethodGet, "/items/search-advanced?q="+url.QueryEscape(k.token)+"&"+query, nil)
}

// Page size and total, no repeats.
func (k *katalog) pageHolds(s *scenarioState, hits, total int) error {
	var resp items.AdvancedSearchResponse
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	if len(resp.Hits) != hits || resp.Total != total {
		return fmt.Errorf("want %d hits of %d, got %d of %d", hits, total, len(resp.Hits), resp.Total)
	}
	if h := s.last.Header.Get("X-Total-Count"); h != strconv.Itoa(total) {
		return fmt.Errorf("want X-Total-Count %d got %q", total, h)
	}
	for _, h := range resp.Hits {
		if k.seen[h.ID] {
			return fmt.Errorf("item %d repeated across pages", h.ID)
		}
		k.seen[h.ID] = true
	}
	return nil
}

func (k *katalog) pagesCoverAll() error {
	if len(k.seen) != len(k.want) {
		return fmt.Errorf("pages held %d of %d items", len(k.seen), len(k.want))
	}
	for id := range k.want {
		if !k.seen[id] {
			return fmt.Errorf("item %d never listed", id)
		}
	}
	return nil
}

func registerRuleSteps(sc *godog.ScenarioContext, state *scenarioState) {
	k := &katalog{}
	sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
		*k = katalog{seen: map[int64]bool{}}
		return ctx, nil
	})
	sc.Step(`^the user renames the item to only (spaces|a tab|newlines)$`, state.renameItemBlank)
	sc.Step(`^the user attaches an image stored under another item$`, state.attachForeignImage)
	sc.Step(`^(\d+) items share a new search token$`, func(n int) error { return k.seed(state, n) })
	sc.Step(`^the user searches the Katalog for the token with "([^"]*)"$`,
		func(q string) error { return k.search(state, q) })
	sc.Step(`^the page holds (\d+) hits? of (\d+)$`, func(h, n int) error { return k.pageHolds(state, h, n) })
	sc.Step(`^the pages together hold every token item$`, k.pagesCoverAll)
}
