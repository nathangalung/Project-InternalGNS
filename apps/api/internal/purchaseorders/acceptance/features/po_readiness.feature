Feature: PO readiness before work starts
  A quotation may leave the client address, the vendor location and the
  shipping address blank. They are required once the PO moves from
  UPLOADED to ON_PROGRESS, and the refusal lists every gap so the
  operator can fill them all in one pass. The narahubung checked is the
  one the quotation chose. The client's own PO number is required too.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: A PO without the client's number is refused at ON_PROGRESS until it is entered
    Given a quotation accepted without a client PO number
    And the PO has reached "UPLOADED"
    When the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | po | po_number | No. PO klien belum diisi |
    When the user edits PO details with number "PO/KLIEN/2026/077" dated "2026-03-02"
    Then the response status is 204
    When the user tries to transition the PO to "ON_PROGRESS"
    Then every PO transition succeeds

  Scenario: An addressless quotation is refused at ON_PROGRESS with every gap listed
    Given an accepted quotation for a new client and vendor without addresses
    And the PO has reached "UPLOADED"
    When the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | klien      | client_address   | belum lengkap: Alamat         |
      | vendor     | vendor_location  | belum lengkap: Lokasi         |
      | pengiriman | shipping_address | Alamat pengiriman belum diisi |

  Scenario: Each filled address clears its gap until work can start
    Given an accepted quotation for a new client and vendor without addresses
    And the PO has reached "UPLOADED"
    When the user fills the client address
    And the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | vendor     | vendor_location  | belum lengkap: Lokasi         |
      | pengiriman | shipping_address | Alamat pengiriman belum diisi |
    When the user fills the vendor location
    And the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | pengiriman | shipping_address | Alamat pengiriman belum diisi |
    When the user fills the PO shipping address
    And the user tries to transition the PO to "ON_PROGRESS"
    Then every PO transition succeeds
    And the PO has reached "ON_PROGRESS"

  Scenario: A deactivated chosen contact blocks work until another is chosen
    Given an accepted quotation for a new client and vendor without addresses
    And every address is filled
    And the PO has reached "UPLOADED"
    When the quotation's chosen contact is deactivated
    And the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | klien | contact_inactive | belum lengkap: Narahubung aktif |
    When the user chooses the client's other contact on the quotation
    And the user tries to transition the PO to "ON_PROGRESS"
    Then every PO transition succeeds
