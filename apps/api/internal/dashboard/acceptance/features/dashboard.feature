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
