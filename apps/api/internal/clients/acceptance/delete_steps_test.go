package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Permanent delete steps.

func (s *scenarioState) deleteClient() error {
	return s.sendRequest(http.MethodDelete, "/clients/"+strconv.FormatInt(s.clientID, 10), nil)
}

func (s *scenarioState) problemReads(code, detail string) error {
	var p httperr.Error
	if err := json.Unmarshal(s.body, &p); err != nil {
		return err
	}
	if p.Code != code || p.Detail != detail {
		return fmt.Errorf("want %q %q body=%s", code, detail, s.body)
	}
	return nil
}

func (s *scenarioState) noContactsLeft() error {
	var n int
	err := testutil.Pool(s.t).QueryRow(context.Background(),
		`SELECT COUNT(*) FROM company_contacts WHERE company_id = $1`, s.clientID).Scan(&n)
	if err != nil {
		return err
	}
	if n != 0 {
		return fmt.Errorf("want no contacts got %d", n)
	}
	return nil
}

func registerDeleteSteps(sc *godog.ScenarioContext, state *scenarioState) {
	sc.Step(`^the user deletes the client permanently$`, state.deleteClient)
	sc.Step(`^the problem is "([^"]+)" reading "([^"]+)"$`, state.problemReads)
	sc.Step(`^no contact of the client is left$`, state.noContactsLeft)
}
