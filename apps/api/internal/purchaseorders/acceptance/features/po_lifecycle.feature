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

  Scenario: Reject a file key that escapes the PO folder
    Given an accepted quotation
    When the user attaches the object key "../../etc/x"
    Then the response status is 422
    And the error rejects the object key
    When the user reads the PO by quotation
    Then the PO has no attached file

  Scenario: Reject a file uploaded for another PO
    Given an accepted quotation
    When the user attaches the file uploaded for another PO
    Then the response status is 422
    And the error rejects the object key
    When the user reads the PO by quotation
    Then the PO has no attached file

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

  Scenario Outline: PO direct edit allowed before delivery
    Given an accepted quotation
    When the user transitions the PO through "<path>"
    Then every PO transition succeeds
    When the user edits PO items with discount "5" and selling price "150000"
    Then the response status is 200

    Examples:
      | path                 |
      |                      |
      | UPLOADED             |
      | UPLOADED,ON_PROGRESS |

  Scenario: PO direct edit locked when delivered
    Given an accepted quotation
    When the user transitions the PO through "UPLOADED,ON_PROGRESS,DELIVERED"
    Then every PO transition succeeds
    When the user edits PO items with discount "0" and selling price "100000"
    Then the response status is 422

  Scenario: Edited PO price flows into invoice
    Given an accepted quotation
    When the user edits PO items with discount "0" and selling price "150000"
    Then the response status is 200
    When the user transitions the PO through "UPLOADED,ON_PROGRESS,DELIVERED"
    Then every PO transition succeeds
    When the user lists invoice items by quotation
    Then the response status is 200
    And an invoice product line has unit price "150000"

  Scenario: PO totals equal the invoice created from the PO
    Given an accepted quotation
    When the user edits PO items with discount "7" and selling price "333333.33"
    Then the response status is 200
    When the user transitions the PO through "UPLOADED,ON_PROGRESS,DELIVERED"
    Then every PO transition succeeds
    When the user reads the PO by quotation
    Then the response status is 200
    And the PO discount is "7.00"
    And the PO totals equal the invoice totals

  Scenario: PO details are locked once the invoice is sent
    Given an accepted quotation
    When the user edits PO details with number "PO/KLIEN/001"
    Then the response status is 204
    When the user transitions the PO through "UPLOADED,ON_PROGRESS,DELIVERED"
    Then every PO transition succeeds
    When the user sends the invoice
    Then the response status is 204
    When the user edits PO details with number "PO/KLIEN/002"
    Then the response status is 409

  Scenario: A stale If-Match on PO details returns 409
    Given an accepted quotation
    When the user edits PO details with a stale If-Match
    Then the response status is 409

  Scenario: A stale If-Match on PO notes returns 409
    Given an accepted quotation
    When the user edits PO notes with a stale If-Match
    Then the response status is 409

  Scenario: Work cannot start while the client master data is incomplete
    Given an accepted quotation for a client with missing data
    When the user transitions the PO through "UPLOADED"
    Then every PO transition succeeds
    When the user tries to transition the PO to "ON_PROGRESS"
    Then the response status is 422
    And the error names the incomplete client

  Scenario: The delivery note is refused before work starts
    Given an accepted quotation
    When the user downloads the delivery note
    Then the response status is 409
    When the user transitions the PO through "UPLOADED"
    Then every PO transition succeeds
    When the user downloads the delivery note
    Then the response status is 409

  Scenario: The delivery note carries the number stored when work starts
    Given an accepted quotation
    When the user transitions the PO through "UPLOADED,ON_PROGRESS"
    Then every PO transition succeeds
    When the user reads the PO by quotation
    Then the PO has a delivery note number
    When the user transitions the PO through "UPLOADED,ON_PROGRESS"
    Then every PO transition succeeds
    When the user reads the PO by quotation
    Then the delivery note number is unchanged
    When the user exports the PO list
    Then the response status is 200
    And the export lists the stored delivery note number

  Scenario: PO lines name the offered catalog item
    Given an accepted quotation offering catalog item 1 for "tolong carikan punching tool"
    When the user lists PO items
    Then the response status is 200
    And the first PO line is named after catalog item 1

  Scenario: An offered item without a code does not borrow the requested code
    Given catalog item 2 has no IMPA code
    And an accepted quotation offering catalog item 2 for "cat biru untuk marking"
    When the user lists PO items
    Then the response status is 200
    And the first PO line is named after catalog item 2
    And the first PO line has no item code
