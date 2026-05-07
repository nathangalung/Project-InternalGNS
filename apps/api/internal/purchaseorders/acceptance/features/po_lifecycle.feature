Feature: Purchase order lifecycle
  Operations team must move a PO through PENDING, UPLOADED,
  ON_PROGRESS and DELIVERED, and DELIVERED must auto-create
  the downstream invoice.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: Accepted quotation auto-creates a pending PO
    Given an accepted quotation
    When the user reads the PO by quotation
    Then the response status is 200
    And the PO status is "PENDING"
    And the PO number is set

  Scenario: Read PO snapshot items
    Given an accepted quotation
    When the user lists PO items
    Then the response status is 200
    And the items contain at least 1 product line

  Scenario Outline: Valid PO status transitions
    Given an accepted quotation
    When the user transitions the PO through "<path>"
    Then every PO transition succeeds

    Examples:
      | path                                |
      | UPLOADED                            |
      | UPLOADED,ON_PROGRESS                |
      | UPLOADED,ON_PROGRESS,DELIVERED      |

  Scenario: Reject invalid transition jump
    Given an accepted quotation
    When the user tries to transition the PO to "DELIVERED"
    Then the response status is 422

  Scenario: Upload file moves PO from PENDING to UPLOADED
    Given an accepted quotation
    When the user uploads a PO file named "po.pdf"
    Then the response status is 204
    When the user reads the PO by quotation
    Then the response status is 200
    And the PO status is "UPLOADED"
    And the PO file name is "po.pdf"

  Scenario: Reject file upload without filename
    Given an accepted quotation
    When the user uploads a PO file with empty filename
    Then the response status is 422

  Scenario: Delivered PO auto-creates draft invoice
    Given an accepted quotation
    When the user transitions the PO through "UPLOADED,ON_PROGRESS,DELIVERED"
    Then every PO transition succeeds
    When the user reads the invoice by quotation
    Then the response status is 200
    And the invoice status is "draft"

  Scenario: List filters return PO rows
    Given an accepted quotation
    When the user lists POs filtered by status "PENDING"
    Then the response status is 200
    And the PO list contains at least 1 row
