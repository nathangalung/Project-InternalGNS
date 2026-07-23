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
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const defaultUserID int64 = 1

type scenarioState struct {
	t      *testing.T
	srv    *httptest.Server
	last   *http.Response
	body   []byte
	userID int64
	email  string
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
	s.srv = testutil.UsersServer(s.t, id)
	return nil
}

func (s *scenarioState) uniqueEmail() string {
	return fmt.Sprintf("atdd_%d@example.test", time.Now().UnixNano())
}

func (s *scenarioState) createStaff() error {
	s.email = s.uniqueEmail()
	s.name = "ATDD Staff"
	body := users.CreateUserRequest{
		Email:    s.email,
		Name:     s.name,
		Password: "secret123",
		Role:     users.RoleOperational,
	}
	if err := s.sendRequest(http.MethodPost, "/users/", body); err != nil {
		return err
	}
	if s.last.StatusCode == http.StatusCreated {
		return s.captureID()
	}
	return nil
}

func (s *scenarioState) createStaffEmptyEmail() error {
	body := users.CreateUserRequest{
		Email:    "",
		Name:     "no email",
		Password: "secret123",
		Role:     users.RoleOperational,
	}
	return s.sendRequest(http.MethodPost, "/users/", body)
}

func (s *scenarioState) createStaffWithPassword(pw string) error {
	body := users.CreateUserRequest{
		Email:    s.uniqueEmail(),
		Name:     "weak pw",
		Password: pw,
		Role:     users.RoleOperational,
	}
	return s.sendRequest(http.MethodPost, "/users/", body)
}

func (s *scenarioState) createStaffWithRole(role string) error {
	body := users.CreateUserRequest{
		Email:    s.uniqueEmail(),
		Name:     "bad role",
		Password: "secret123",
		Role:     users.Role(role),
	}
	return s.sendRequest(http.MethodPost, "/users/", body)
}

func (s *scenarioState) createStaffSeededEmail() error {
	body := users.CreateUserRequest{
		Email:    s.email,
		Name:     "duplicate",
		Password: "secret123",
		Role:     users.RoleOperational,
	}
	return s.sendRequest(http.MethodPost, "/users/", body)
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
	s.userID = resp.ID
	return nil
}

func (s *scenarioState) seedStaff() error {
	if err := s.createStaff(); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("seed want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) responseHasUserID() error { return s.captureID() }

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) readStaff() error {
	return s.sendRequest(http.MethodGet, "/users/"+strconv.FormatInt(s.userID, 10), nil)
}

func (s *scenarioState) emailMatches() error {
	var u users.User
	if err := json.Unmarshal(s.body, &u); err != nil {
		return err
	}
	if u.Email != s.email {
		return fmt.Errorf("want %s got %s", s.email, u.Email)
	}
	return nil
}

func (s *scenarioState) updateStaffName() error {
	s.name = "ATDD Staff Renamed"
	body := users.UpdateUserRequest{
		Email:    s.email,
		Name:     s.name,
		Role:     users.RoleOperational,
		IsActive: true,
	}
	return s.sendRequest(http.MethodPut, "/users/"+strconv.FormatInt(s.userID, 10), body)
}

func (s *scenarioState) nameMatches() error {
	var u users.User
	if err := json.Unmarshal(s.body, &u); err != nil {
		return err
	}
	if u.Name != s.name {
		return fmt.Errorf("want %s got %s", s.name, u.Name)
	}
	return nil
}

func (s *scenarioState) changePassword(pw string) error {
	body := users.ChangePasswordRequest{Password: pw}
	return s.sendRequest(http.MethodPatch, "/users/"+strconv.FormatInt(s.userID, 10)+"/password", body)
}

func (s *scenarioState) listByRole(role string) error {
	return s.sendRequest(http.MethodGet, "/users/?role="+url.QueryEscape(role), nil)
}

func (s *scenarioState) staffListAtLeast(min int) error {
	var rows []users.User
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
			state.userID = 0
			state.email = ""
			state.name = ""
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the user creates a staff account$`, state.createStaff)
		sc.Step(`^the user creates a staff account with empty email$`, state.createStaffEmptyEmail)
		sc.Step(`^the user creates a staff account with password "([^"]+)"$`, state.createStaffWithPassword)
		sc.Step(`^the user creates a staff account with role "([^"]+)"$`, state.createStaffWithRole)
		sc.Step(`^the user creates a staff account with the seeded email$`, state.createStaffSeededEmail)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the response contains a user id$`, state.responseHasUserID)
		sc.Step(`^an existing staff account$`, state.seedStaff)
		sc.Step(`^the user reads the staff account$`, state.readStaff)
		sc.Step(`^the user email matches the seeded value$`, state.emailMatches)
		sc.Step(`^the user updates the staff name$`, state.updateStaffName)
		sc.Step(`^the user name reflects the update$`, state.nameMatches)
		sc.Step(`^the user changes the password to "([^"]+)"$`, state.changePassword)
		sc.Step(`^the user lists staff filtered by role "([^"]+)"$`, state.listByRole)
		sc.Step(`^the staff list contains at least (\d+) row(?:s)?$`, state.staffListAtLeast)
	}
}

func TestUsersFeatures(t *testing.T) {
	testutil.RequireDB(t)
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
