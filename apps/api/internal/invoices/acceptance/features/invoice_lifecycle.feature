Feature: Invoice lifecycle
  Finance team must move an invoice through draft, sent and paid,
  and the invoice must materialize as a snapshot of its source PO.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: Delivered PO auto-creates draft invoice
    Given a delivered purchase order
    When the user reads the invoice by quotation
    Then the response status is 200
    And the invoice status is "draft"
    And the invoice number is set
    And the invoice has positive total

  Scenario: Read invoice snapshot items
    Given a delivered purchase order
    When the user lists invoice items
    Then the response status is 200
    And the invoice items contain at least 1 product line

  Scenario Outline: Valid invoice status transitions
    Given a delivered purchase order
    When the user transitions the invoice through "<path>"
    Then every invoice transition succeeds

    Examples:
      | path        |
      | sent        |
      | sent,paid   |

  Scenario: Reject unknown status value
    Given a delivered purchase order
    When the user tries to transition the invoice to "garbage"
    Then the response status is 422

  Scenario: Update invoice dates
    Given a delivered purchase order
    When the user updates invoice due date to "2026-12-31"
    Then the response status is 204

  Scenario: Summary endpoint returns aggregates
    Given a delivered purchase order
    When the user reads the invoice summary
    Then the response status is 200
    And the invoice summary total is at least 1
    And the invoice summary buckets sum to total

  Scenario: List filters return invoice rows
    Given a delivered purchase order
    When the user lists invoices filtered by status "draft"
    Then the response status is 200
    And the invoice list contains at least 1 row
