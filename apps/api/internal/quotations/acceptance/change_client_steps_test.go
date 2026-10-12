package acceptance_test

import (
	"context"
	"fmt"
	"net/http"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const sisterName = "PT Saudara Holding QATDD"

// seedContact is the master seed's narahubung of client 1.
const seedContact int64 = 1

// sisterOfHolding adds a client and contact.
// Its quotations go first at teardown, so the client row can follow.
func (s *scenarioState) sisterOfHolding() error {
	ctx := context.Background()
	pool := testutil.Pool(s.t)
	if err := pool.QueryRow(ctx, `
		INSERT INTO company_client (name, created_by, updated_by) VALUES ($1, 1, 1) RETURNING id`,
		sisterName).Scan(&s.sister); err != nil {
		return err
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, email, created_by, updated_by)
		VALUES ($1, 'Ibu Sari', 'sari@holding.test', 1, 1) RETURNING id`, s.sister).Scan(&s.sisterContact); err != nil {
		return err
	}
	id := s.sister
	s.t.Cleanup(func() {
		_ = testutil.ResetQuotationDomain(ctx, pool)
		_, _ = pool.Exec(ctx, `DELETE FROM company_contacts WHERE company_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM company_client WHERE id = $1`, id)
	})
	return nil
}

func (s *scenarioState) claimHeaderOf(id int64) error {
	if err := s.sendRequest(http.MethodPost, idPath(id, "/locks"), quotations.LockRequest{Part: "header"}); err != nil {
		return err
	}
	return s.statusEquals(http.StatusOK)
}

func (s *scenarioState) moveQuotation(id, contact int64) error {
	return s.sendRequest(http.MethodPatch, idPath(id, "/client"),
		quotations.ChangeClientRequest{ClientID: s.sister, ContactID: &contact})
}

// The seed client's own narahubung.
func (s *scenarioState) moveWithForeignContact() error {
	return s.moveQuotation(s.lastID, seedContact)
}

func (s *scenarioState) namesSister() error {
	d, err := s.readByID(s.lastID)
	if err != nil {
		return err
	}
	if d.CompanyClientID != s.sister || d.CompanyClientName != sisterName {
		return fmt.Errorf("want client %q got %d %q", sisterName, d.CompanyClientID, d.CompanyClientName)
	}
	if d.ContactID == nil || *d.ContactID != s.sisterContact || d.ContactName == nil || *d.ContactName != "Ibu Sari" {
		return fmt.Errorf("want narahubung Ibu Sari got %v %v", d.ContactID, d.ContactName)
	}
	return nil
}

func (s *scenarioState) historyEndsNoting(note string) error {
	d, err := s.readByID(s.lastID)
	if err != nil {
		return err
	}
	last := d.History[len(d.History)-1]
	if last.FromStatus == nil || *last.FromStatus != quotations.StatusDraft ||
		last.ToStatus != quotations.StatusDraft || last.Note == nil || *last.Note != note {
		return fmt.Errorf("latest history %+v, want draft to draft noting %q", last, note)
	}
	return nil
}

func (s *scenarioState) originalKeepsClient() error {
	d, err := s.readByID(s.origID)
	if err != nil {
		return err
	}
	if d.CompanyClientID != defaultCompany {
		return fmt.Errorf("original moved to client %d", d.CompanyClientID)
	}
	return nil
}

func registerChangeClientSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^a sister company of the same holding$`, s.sisterOfHolding)
	sc.Step(`^the user claims the header$`, func() error { return s.claimHeaderOf(s.lastID) })
	sc.Step(`^the user claims the header of the new revision$`, func() error { return s.claimHeaderOf(s.newID) })
	sc.Step(`^the user moves the quotation to the sister company with its narahubung$`, func() error {
		return s.moveQuotation(s.lastID, s.sisterContact)
	})
	sc.Step(`^the user moves the quotation to the sister company with the first client's narahubung$`, s.moveWithForeignContact)
	sc.Step(`^the user moves the new revision to the sister company$`, func() error {
		return s.moveQuotation(s.newID, s.sisterContact)
	})
	sc.Step(`^the quotation names the sister company and its narahubung$`, s.namesSister)
	sc.Step(`^the quotation history ends noting "([^"]+)"$`, s.historyEndsNoting)
	sc.Step(`^the original quotation keeps its client$`, s.originalKeepsClient)
}
