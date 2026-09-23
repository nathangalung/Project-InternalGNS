Feature: Purchase order lifecycle
  Operations team must move a PO through PENDING, UPLOADED,
  ON_PROGRESS and DELIVERED, and DELIVERED must auto-create
  the downstream invoice. UPLOADED follows the PO file, and a
  PO can be cancelled with a reason until it is delivered.

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
    And the PO has reached "UPLOADED"
    When the user transitions the PO through "<path>"
    Then every PO transition succeeds
    When the user reads the PO by quotation
    Then the PO status is "<final>"

    Examples:
      | path                  | final       |
      | ON_PROGRESS           | ON_PROGRESS |
      | ON_PROGRESS,DELIVERED | DELIVERED   |
      | ON_PROGRESS,UPLOADED  | UPLOADED    |

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
    And the PO has reached "DELIVERED"
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
    And the PO has reached "<status>"
    When the user edits PO items with discount "5" and selling price "150000"
    Then the response status is 200

    Examples:
      | status      |
      | PENDING     |
      | UPLOADED    |
      | ON_PROGRESS |

  Scenario: PO direct edit locked when delivered
    Given an accepted quotation
    And the PO has reached "DELIVERED"
    When the user edits PO items with discount "0" and selling price "100000"
    Then the response status is 422

  Scenario: Edited PO price flows into invoice
    Given an accepted quotation
    When the user edits PO items with discount "0" and selling price "150000"
    Then the response status is 200
    And the PO has reached "DELIVERED"
    When the user lists invoice items by quotation
    Then the response status is 200
    And an invoice product line has unit price "150000"

  Scenario: PO totals equal the invoice created from the PO
    Given an accepted quotation
    When the user edits PO items with discount "7" and selling price "333333.33"
    Then the response status is 200
    And the PO has reached "DELIVERED"
    When the user reads the PO by quotation
    Then the response status is 200
    And the PO discount is "7.00"
    And the PO totals equal the invoice totals

  Scenario: PO details are locked once the invoice is sent
    Given an accepted quotation
    When the user edits PO details with number "PO/KLIEN/001"
    Then the response status is 204
    And the PO has reached "DELIVERED"
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
    And the PO has reached "UPLOADED"
    When the user tries to transition the PO to "ON_PROGRESS"
    Then the response status is 422
    And the error names the incomplete client

  Scenario: The delivery note is refused before work starts
    Given an accepted quotation
    When the user downloads the delivery note
    Then the response status is 409
    And the PO has reached "UPLOADED"
    When the user downloads the delivery note
    Then the response status is 409

  Scenario: The delivery note carries the number stored when work starts
    Given an accepted quotation
    And the PO has reached "ON_PROGRESS"
    When the user reads the PO by quotation
    Then the PO has a delivery note number
    When the user transitions the PO through "UPLOADED,ON_PROGRESS"
    Then every PO transition succeeds
    When the user reads the PO by quotation
    Then the delivery note number is unchanged
    When the user exports the PO list
    Then the response status is 200
    And the export lists the stored delivery note number
    And the export shows the status "Dalam Progres"

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

  Scenario: PENDING cannot be moved to UPLOADED by hand
    Given an accepted quotation
    When the user tries to transition the PO to "UPLOADED"
    Then the response status is 422
    And the problem detail mentions "berkas PO"
    When the user reads the PO by quotation
    Then the PO status is "PENDING"

  Scenario: UPLOADED cannot be moved back to PENDING by hand
    Given an accepted quotation
    And the PO has reached "UPLOADED"
    When the user tries to transition the PO to "PENDING"
    Then the response status is 422
    And the problem detail mentions "berkas PO"

  Scenario: Removing the PO file moves the PO back to PENDING
    Given an accepted quotation
    And the PO has reached "UPLOADED"
    When the user removes the PO file
    Then the response status is 204
    When the user reads the PO by quotation
    Then the PO status is "PENDING"
    And the PO has no attached file
    And the PO history ends with "UPLOADED" to "PENDING"

  Scenario Outline: The PO file stays once work has started
    Given an accepted quotation
    And the PO has reached "<status>"
    When the user removes the PO file
    Then the response status is 409
    When the user reads the PO by quotation
    Then the PO status is "<status>"

    Examples:
      | status      |
      | ON_PROGRESS |
      | DELIVERED   |
      | CANCELLED   |

  Scenario: Work moves back to UPLOADED while the file stays
    Given an accepted quotation
    And the PO has reached "ON_PROGRESS"
    When the user transitions the PO through "UPLOADED"
    Then every PO transition succeeds

  Scenario Outline: A PO is cancelled with a reason before delivery
    Given an accepted quotation
    And the PO has reached "<status>"
    When the user cancels the PO with reason "Klien membatalkan pesanan"
    Then the response status is 204
    When the user reads the PO by quotation
    Then the PO status is "CANCELLED"
    And the PO offers no transitions
    And the PO history ends with "<status>" to "CANCELLED" noting "Klien membatalkan pesanan"

    Examples:
      | status      |
      | PENDING     |
      | UPLOADED    |
      | ON_PROGRESS |

  Scenario: Cancelling without a reason is refused
    Given an accepted quotation
    When the user cancels the PO with reason "   "
    Then the response status is 422
    And the problem detail mentions "Alasan pembatalan wajib diisi"
    When the user reads the PO by quotation
    Then the PO status is "PENDING"

  Scenario Outline: Delivered and cancelled POs are terminal
    Given an accepted quotation
    And the PO has reached "<status>"
    When the user <action>
    Then the response status is 422
    When the user reads the PO by quotation
    Then the PO status is "<status>"

    Examples:
      | status    | action                                         |
      | DELIVERED | tries to transition the PO to "ON_PROGRESS"    |
      | DELIVERED | cancels the PO with reason "Salah kirim"       |
      | CANCELLED | tries to transition the PO to "ON_PROGRESS"    |
      | CANCELLED | tries to transition the PO to "UPLOADED"       |

  Scenario: A cancelled PO cannot be edited
    Given an accepted quotation
    And the PO has reached "CANCELLED"
    When the user edits PO items with discount "0" and selling price "100000"
    Then the response status is 422

  Scenario: A cancelled PO has no delivery note
    Given an accepted quotation
    And the PO has reached "ON_PROGRESS"
    And the PO has reached "CANCELLED"
    When the user downloads the delivery note
    Then the response status is 409

  Scenario Outline: The PO offers the transitions the database allows
    Given an accepted quotation
    And the PO has reached "<status>"
    When the user reads the PO by quotation
    Then the PO offers the transitions "<offered>"
    And only the cancellation requires a note

    Examples:
      | status      | offered                          |
      | PENDING     | CANCELLED                        |
      | UPLOADED    | ON_PROGRESS,CANCELLED            |
      | ON_PROGRESS | DELIVERED,UPLOADED,CANCELLED     |
      | DELIVERED   |                                  |

  Scenario: The PO list rows carry their transitions
    Given an accepted quotation
    When the user lists POs filtered by status "PENDING"
    Then every PO row offers the transitions for its status

  Scenario: The PO history records creation and the file upload
    Given an accepted quotation
    And the PO has reached "UPLOADED"
    When the user reads the PO history
    Then the response status is 200
    And the PO history starts with the creation as "PENDING"
    And the PO history ends with "PENDING" to "UPLOADED"

  Scenario Outline: Only superadmin and operational change PO status
    Given an accepted quotation
    And a signed-in "<role>" user
    When that user cancels the PO with reason "Dibatalkan klien"
    Then the response status is <status>

    Examples:
      | role        | status |
      | finance     | 403    |
      | operational | 204    |
      | superadmin  | 204    |
