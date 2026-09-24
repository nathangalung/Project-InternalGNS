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

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Named blanks, since Gherkin cells trim.
var blanks = map[string]string{
	"spaces":   "   ",
	"a tab":    "\t",
	"newlines": "\n\r\n ",
}

func (s *scenarioState) vendorPath(rest string) string {
	return "/vendors/" + strconv.FormatInt(s.vendorID, 10) + rest
}

func (s *scenarioState) createVendorBlank(kind string) error {
	return s.sendRequest(http.MethodPost, "/vendors/", vendors.CreateVendorRequest{Name: blanks[kind]})
}

func (s *scenarioState) renameVendorBlank(kind string) error {
	return s.sendRequest(http.MethodPut, s.vendorPath(""),
		vendors.UpdateVendorRequest{Name: blanks[kind], IsActive: true})
}

// The decoy only matches an unescaped wildcard.
func (s *scenarioState) seedWildcardPair(wildcard string) error {
	nonce := time.Now().UnixNano()
	for _, name := range []string{
		fmt.Sprintf("ATDD LIAR X %d", nonce),
		fmt.Sprintf("ATDD LIAR %s %d", wildcard, nonce),
	} {
		s.name = name
		if err := s.seedVendorNamed(name); err != nil {
			return err
		}
	}
	return nil
}

func (s *scenarioState) seedVendorNamed(name string) error {
	if err := s.sendRequest(http.MethodPost, "/vendors/", vendors.CreateVendorRequest{Name: name}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return s.captureID()
}

func (s *scenarioState) listByLiteralName() error {
	return s.sendRequest(http.MethodGet, "/vendors/?q="+url.QueryEscape(s.name), nil)
}

func (s *scenarioState) listHoldsOnlySeeded() error {
	var rows []vendors.Vendor
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) != 1 || rows[0].ID != s.vendorID {
		return fmt.Errorf("want only vendor %d body=%s", s.vendorID, s.body)
	}
	return nil
}

func (s *scenarioState) sendGet(path string) error {
	return s.sendRequest(http.MethodGet, path, nil)
}

// attachForeignLogo points at another vendor's upload.
func (s *scenarioState) attachForeignLogo() error {
	key := fmt.Sprintf("vendors/%d/logo.png", s.vendorID+1)
	return s.sendRequest(http.MethodPatch, s.vendorPath("/logo"), vendors.UpdateLogoRequest{ObjectKey: key})
}

// seedVendorOffering links n fresh items in one statement.
func (s *scenarioState) seedVendorOffering(n int) error {
	ctx := context.Background()
	rows, err := testutil.Pool(s.t).Query(ctx, `
		WITH v AS (
		  INSERT INTO vendors (name, created_by, updated_by) VALUES ($1, 1, 1) RETURNING id
		), it AS (
		  INSERT INTO items (name, created_by, updated_by)
		  SELECT $1 || ' ITEM ' || g, 1, 1 FROM generate_series(1, $2::int) AS g RETURNING id
		)
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		SELECT v.id, it.id, 1000, 1, 1 FROM v, it
		RETURNING vendor_id, item_id`, s.uniqueName("ATDD MD12"), n)
	if err != nil {
		return fmt.Errorf("seed vendor offering: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var vendorID, itemID int64
		if err := rows.Scan(&vendorID, &itemID); err != nil {
			return err
		}
		if s.vendorID != vendorID {
			s.vendorID = vendorID
			s.cleaner.Vendor(vendorID)
		}
		s.cleaner.Item(itemID)
	}
	return rows.Err()
}

func (s *scenarioState) listProducts(query string) error {
	return s.sendRequest(http.MethodGet, s.vendorPath("/items?"+query), nil)
}

func (s *scenarioState) pageHolds(rows, total int) error {
	var got []vendors.ItemByVendor
	if err := json.Unmarshal(s.body, &got); err != nil {
		return err
	}
	if len(got) != rows {
		return fmt.Errorf("want %d rows got %d", rows, len(got))
	}
	if h := s.last.Header.Get("X-Total-Count"); h != strconv.Itoa(total) {
		return fmt.Errorf("want X-Total-Count %d got %q", total, h)
	}
	return nil
}

func registerRuleSteps(sc *godog.ScenarioContext, state *scenarioState) {
	sc.Step(`^the user creates a vendor named with only (spaces|a tab|newlines)$`, state.createVendorBlank)
	sc.Step(`^the user renames the vendor to only (spaces|a tab|newlines)$`, state.renameVendorBlank)
	sc.Step(`^a vendor named with "([^"]+)" and a decoy without it$`, state.seedWildcardPair)
	sc.Step(`^the user lists vendors searching for the literal name$`, state.listByLiteralName)
	sc.Step(`^the vendor list holds only the vendor with the wildcard$`, state.listHoldsOnlySeeded)
	sc.Step(`^the user sends GET "([^"]+)"$`, state.sendGet)
	sc.Step(`^the user attaches a logo stored under another vendor$`, state.attachForeignLogo)
	sc.Step(`^a vendor offering (\d+) products$`, state.seedVendorOffering)
	sc.Step(`^the user lists the vendor's products with "([^"]*)"$`, state.listProducts)
	sc.Step(`^the page holds (\d+) products? of (\d+)$`, state.pageHolds)
}
