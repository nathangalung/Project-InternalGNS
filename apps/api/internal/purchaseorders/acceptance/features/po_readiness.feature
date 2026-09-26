Feature: PO readiness before work starts
  A quotation may leave the client address, the vendor location and the
  shipping address blank. They are required once the PO moves from
  UPLOADED to ON_PROGRESS, and the refusal lists every gap so the
  operator can fill them all in one pass. The narahubung checked is the
  one the quotation chose.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: An addressless quotation is refused at ON_PROGRESS with every gap listed
    Given an accepted quotation for a new client and vendor without addresses
    And the PO has reached "UPLOADED"
    When the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | klien      | belum lengkap: Alamat         |
      | vendor     | belum lengkap: Lokasi         |
      | pengiriman | Alamat pengiriman belum diisi |

  Scenario: Each filled address clears its gap until work can start
    Given an accepted quotation for a new client and vendor without addresses
    And the PO has reached "UPLOADED"
    When the user fills the client address
    And the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | vendor     | belum lengkap: Lokasi         |
      | pengiriman | Alamat pengiriman belum diisi |
    When the user fills the vendor location
    And the user tries to transition the PO to "ON_PROGRESS"
    Then the gate lists exactly these gaps:
      | pengiriman | Alamat pengiriman belum diisi |
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
      | klien | belum lengkap: Narahubung aktif |
    When the user chooses the client's other contact on the quotation
    And the user tries to transition the PO to "ON_PROGRESS"
    Then every PO transition succeeds
