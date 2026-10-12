package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const sisterName = "PT Saudara Holding ATDD"

// sisterCompany is the other holding member.
type sisterCompany struct {
	id, contact int64
}

// sisterOfHolding adds a complete client.
// It passes the PO gate, so delivery can bill it.
func (s *scenarioState) sisterOfHolding() error {
	ctx := context.Background()
	pool := testutil.Pool(s.t)
	var c sisterCompany
	if err := pool.QueryRow(ctx, `
		INSERT INTO company_client (name, npwp, address, country_code, created_by, updated_by)
		VALUES ($1, '0213456789012345', 'Jl. Gatot Subroto No. 5, Jakarta', 'IDN', 1, 1)
		RETURNING id`, sisterName).Scan(&c.id); err != nil {
		return err
	}
	s.cleaner.Client(c.id)
	if err := pool.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, email, country_code, created_by, updated_by)
		VALUES ($1, 'Ibu Sari', 'sari@holding.test', 'IDN', 1, 1) RETURNING id`, c.id).Scan(&c.contact); err != nil {
		return err
	}
	s.sister = &c
	return nil
}

// moveTo sends the change with a version.
func (s *scenarioState) moveTo(contact *int64, version string) error {
	body := purchaseorders.ChangeClientRequest{ClientID: s.sister.id, ContactID: contact}
	return s.sendRequestWithHeaders(http.MethodPatch, s.poPath("/client"), body,
		map[string]string{"If-Match": version})
}

func (s *scenarioState) moveToSister() error {
	version, err := s.currentVersion()
	if err != nil {
		return err
	}
	return s.moveTo(&s.sister.contact, version)
}

// The seed client's own narahubung.
func (s *scenarioState) moveToSisterWithForeignContact() error {
	version, err := s.currentVersion()
	if err != nil {
		return err
	}
	foreign := int64(1)
	return s.moveTo(&foreign, version)
}

func (s *scenarioState) moveToSisterStale() error {
	return s.moveTo(&s.sister.contact, "9999")
}

func (s *scenarioState) roleUserMovesToSister() error {
	body := purchaseorders.ChangeClientRequest{ClientID: s.sister.id, ContactID: &s.sister.contact}
	return s.sendAsRole(http.MethodPatch, "/api/v1"+s.poPath("/client"), body)
}

// The sister's own PO with this number.
func (s *scenarioState) sisterHoldsSameNumber() error {
	qID, poID, number := s.quotationID, s.poID, s.poNumber
	defer func() { s.quotationID, s.poID, s.poNumber = qID, poID, number }()
	if err := s.acceptedQuotationForCompany(s.sister.id); err != nil {
		return err
	}
	if err := s.editPODetails(number); err != nil {
		return err
	}
	return s.statusEquals(http.StatusNoContent)
}

func (s *scenarioState) poBelongsToSister() error {
	po, err := s.readPO()
	if err != nil {
		return err
	}
	if po.CompanyClientID != s.sister.id || po.CompanyName != sisterName {
		return fmt.Errorf("want client %d %q got %d %q", s.sister.id, sisterName, po.CompanyClientID, po.CompanyName)
	}
	if po.ContactID == nil || *po.ContactID != s.sister.contact || po.ContactName == nil || *po.ContactName != "Ibu Sari" {
		return fmt.Errorf("want the sister's narahubung got %s", s.body)
	}
	return nil
}

func (s *scenarioState) invoiceBillsSister() error {
	var inv invoices.InvoiceDetail
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	if inv.CompanyClientID != s.sister.id || inv.CompanyName != sisterName {
		return fmt.Errorf("want buyer %q got %s", sisterName, s.body)
	}
	if inv.ContactName == nil || *inv.ContactName != "Ibu Sari" {
		return fmt.Errorf("want narahubung Ibu Sari got %s", s.body)
	}
	return nil
}

func registerChangeClientSteps(sc *godog.ScenarioContext, s *scenarioState) {
	sc.Step(`^a sister company of the same holding$`, s.sisterOfHolding)
	sc.Step(`^the sister company already has a PO numbered like this one$`, s.sisterHoldsSameNumber)
	sc.Step(`^the user moves the PO to the sister company with its narahubung$`, s.moveToSister)
	sc.Step(`^the user moves the PO to the sister company with the first client's narahubung$`, s.moveToSisterWithForeignContact)
	sc.Step(`^the user moves the PO to the sister company with a stale If-Match$`, s.moveToSisterStale)
	sc.Step(`^that user moves the PO to the sister company$`, s.roleUserMovesToSister)
	sc.Step(`^the PO belongs to the sister company$`, s.poBelongsToSister)
	sc.Step(`^the invoice bills the sister company$`, s.invoiceBillsSister)
}
