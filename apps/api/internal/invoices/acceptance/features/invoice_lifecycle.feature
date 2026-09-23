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

  Scenario: Invoice detail carries the client and PO header
    Given a delivered purchase order
    When the user reads the invoice by quotation
    Then the response status is 200
    And the invoice detail carries the client and purchase order header
    And the invoice detail offers the transitions the database allows

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

  Scenario: Saving an unchanged past-due draft is accepted
    Given a delivered purchase order
    When the user updates invoice due date to "2020-01-01"
    And the user tries to transition the invoice to "draft"
    Then the response status is 204

  Scenario: A past-due draft saved as Terlambat stays a draft
    Given a delivered purchase order
    When the user updates invoice due date to "2020-01-01"
    And the user tries to transition the invoice to "overdue"
    Then the response status is 204
    When the user reads the invoice by quotation
    Then the invoice status is "draft"

  Scenario: Terlambat cannot be chosen by hand before the due date
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user tries to transition the invoice to "overdue"
    Then the response status is 422

  Scenario: Reject unknown status value
    Given a delivered purchase order
    When the user tries to transition the invoice to "garbage"
    Then the response status is 422

  Scenario: Update invoice dates
    Given a delivered purchase order
    When the user updates invoice due date to "2026-12-31"
    Then the response status is 200

  Scenario: Paid invoice keeps its dates
    Given a delivered purchase order
    When the user transitions the invoice through "sent,paid"
    And the user updates invoice due date to "2026-12-31"
    Then the response status is 422

  Scenario: Cancelled invoice keeps its dates
    Given a delivered purchase order
    When the user transitions the invoice through "cancelled"
    And the user updates invoice due date to "2026-12-31"
    Then the response status is 422

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

  Scenario: A cancelled invoice is replaced by a Pengganti invoice
    Given a delivered purchase order
    When the user transitions the invoice through "sent,cancelled"
    And the user replaces the invoice
    Then the response status is 201
    When the user reads the invoice by quotation
    Then the invoice status is "draft"
    And the invoice is the Pengganti of the cancelled invoice

  Scenario: Only a cancelled invoice can be replaced
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user replaces the invoice
    Then the response status is 422

  Scenario: A cancelled invoice is replaced only once
    Given a delivered purchase order
    When the user transitions the invoice through "cancelled"
    And the user replaces the invoice
    And the user replaces the invoice
    Then the response status is 409

  Scenario: A catalog rename leaves an issued invoice unchanged
    Given a delivered purchase order offering a catalog item
    When the user lists invoice items
    Then the invoice items name the offered item as issued
    When the user transitions the invoice through "sent"
    And the offered catalog item is renamed
    And the user lists invoice items
    Then the response status is 200
    And the invoice items name the offered item as issued
    And the Coretax export names the offered item as issued
