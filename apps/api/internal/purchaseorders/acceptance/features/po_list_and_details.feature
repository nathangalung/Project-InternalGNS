Feature: PO list, export and client PO details
  Operations records the client's own PO number and date on the PO,
  and finds POs by the total the list shows. The export is the delivery
  note register, so it lists a note number only where the note can be
  printed. Finance works on invoices and never opens a PO.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: The client's PO number and date are saved
    Given an accepted quotation
    When the user edits PO details with number "PO/KLIEN/2026/015" dated "2026-03-02"
    Then the response status is 204
    When the user reads the PO by quotation
    Then the PO number is "PO/KLIEN/2026/015" dated "2026-03-02"

  Scenario Outline: Unusable PO details are refused (PO-08)
    Given an accepted quotation
    When the user <edit>
    Then the response status is 422
    And the problem detail mentions "<message>"
    When the user reads the PO by quotation
    Then the PO keeps its generated number

    Examples:
      | edit                                                        | message               |
      | edits PO details with a number of 51 characters             | Isian terlalu panjang |
      | edits PO details with number "PO/1" dated "2026-02-30"      | YYYY-MM-DD            |
      | edits PO details with number "   " dated "2026-02-03"       | required              |

  Scenario: A client PO number is unique per client
    Given an accepted quotation
    And another PO of the same client holds the number "PO/KLIEN/DUP"
    When the user edits PO details with number "PO/KLIEN/DUP"
    Then the response status is 422
    And the field "poNumber" says "sudah dipakai PO lain untuk klien ini"

  Scenario: The total filter follows the PO's own total (PO-06)
    Given an accepted quotation
    When the user edits PO items with discount "0" and selling price "250000"
    Then the response status is 200
    When the user lists POs with a total of at least "250000"
    Then the PO list includes the PO
    When the user lists POs with a total of at most "250000"
    Then the PO list excludes the PO
    When the user exports the PO list
    Then the export shows the PO total "277500.00"

  Scenario Outline: A walked-back PO leaves the register blank (PO-14)
    Given an accepted quotation
    And the PO has reached "ON_PROGRESS"
    When the user <step back>
    Then the response status is 204
    When the user exports the PO list
    Then the export lists no delivery note number for the PO

    Examples:
      | step back                                   |
      | transitions the PO through "UPLOADED"       |
      | cancels the PO with reason "Salah pesanan"  |

  Scenario Outline: Only superadmin and operational open POs
    Given an accepted quotation
    And a signed-in "<role>" user
    When that user lists the POs
    Then the response status is <status>
    When that user reads the PO
    Then the response status is <status>

    Examples:
      | role        | status |
      | finance     | 403    |
      | operational | 200    |
      | superadmin  | 200    |
