Feature: Dashboard financial figures
  Finance reads revenue, expenses and net profit on the DPP base: PPN is
  collected for the state, so it is never booked as income.

  Background:
    Given the commercial domain is empty

  Scenario: Net profit equals paid DPP minus cost
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is paid
    When finance reads the dashboard summary
    Then the response status is 200
    And revenue is 200000.00 and equals the paid DPP sum
    And expenses are 80000.00 and equal the paid cost sum
    And net profit is 120000.00
    And PPN is 22000.00 and equals the paid PPN sum

  Scenario: An unpaid invoice books nothing
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is sent
    When finance reads the dashboard summary
    Then the response status is 200
    And revenue is 0 and equals the paid DPP sum
    And net profit is 0

  Scenario: A cancelled invoice and its Pengganti count as one invoice
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is cancelled and replaced
    When finance reads the dashboard summary
    Then the response status is 200
    And the dashboard counts 1 invoice
    And the invoice tiles read "draft:1,sent:0,overdue:0,paid:0,cancelled:1"

  Scenario: Ditolak counts only rejected quotations
    Given a quotation in status "rejected"
    And a quotation in status "expired"
    When operational reads the dashboard summary
    Then the response status is 200
    And the quotation tiles read "draft:0,sent:0,revision:0,accepted:0,rejected:1,cancelled:0,expired:1"
    And the dashboard counts 1 rejected quotation

  Scenario: Operational sees operational tiles only
    Given an invoice for 2 units at 100000 costing 40000 each
    When operational reads the dashboard summary
    Then the response status is 200
    And the purchase order tiles read "PENDING:0,UPLOADED:0,ON_PROGRESS:0,DELIVERED:1,CANCELLED:0"
    And the invoice tiles read ""

  Scenario: A past-due sent invoice is Terlambat
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is sent
    And the invoice is past its due date
    When finance reads the dashboard summary
    Then the response status is 200
    And the invoice tiles read "draft:0,sent:0,overdue:1,paid:0,cancelled:0"
