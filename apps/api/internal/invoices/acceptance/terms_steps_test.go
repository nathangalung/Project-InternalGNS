package acceptance_test

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// deliveredWithTerms invoices agreed terms.
func (s *scenarioState) deliveredWithTerms(terms string) error {
	return s.deliverQuotation(quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: defaultCompany,
		DiscountPct:     "0",
		PaymentTerms:    &terms,
		Items: []quotations.CreateItem{{
			RequestedName: "Terms Product",
			Qty:           "1",
			UnitID:        defaultUnit,
			SellingPrice:  "100000",
		}},
	})
}

// readDetail decodes the last body.
func (s *scenarioState) readDetail() (invoices.InvoiceDetail, error) {
	var det invoices.InvoiceDetail
	if err := json.Unmarshal(s.body, &det); err != nil {
		return det, fmt.Errorf("invoice detail: %w body=%s", err, s.body)
	}
	return det, nil
}

// invoiceTermsRead checks the snapshot.
func (s *scenarioState) invoiceTermsRead(want string) error {
	det, err := s.readDetail()
	if err != nil {
		return err
	}
	if det.PaymentTerms == nil || *det.PaymentTerms != want {
		return fmt.Errorf("want payment terms %q got %v body=%s", want, det.PaymentTerms, s.body)
	}
	return nil
}

// invoiceDueAfter checks the due date.
func (s *scenarioState) invoiceDueAfter(days int) error {
	det, err := s.readDetail()
	if err != nil {
		return err
	}
	if det.DueDate == nil {
		return fmt.Errorf("invoice has no due date body=%s", s.body)
	}
	want := det.InvoiceDate.AddDate(0, 0, days).Format(time.DateOnly)
	if got := det.DueDate.Format(time.DateOnly); got != want {
		return fmt.Errorf("want due %s, %d days after %s, got %s",
			want, days, det.InvoiceDate.Format(time.DateOnly), got)
	}
	return nil
}

func (s *scenarioState) registerTermsSteps(sc *godog.ScenarioContext) {
	sc.Step(`^a delivered purchase order with payment terms "([^"]+)"$`, s.deliveredWithTerms)
	sc.Step(`^the invoice payment terms read "([^"]+)"$`, s.invoiceTermsRead)
	sc.Step(`^the invoice is due (\d+) days after its date$`, s.invoiceDueAfter)
}
