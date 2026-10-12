Feature: Change the PO's client
  A client's PO can come from another company of the same holding. The
  heads move the PO to that client, with its own narahubung, until the PO
  is delivered: the invoice copies the buyer at delivery, so a delivered or
  cancelled PO keeps its client. The quotation keeps its own client.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: The PO moves to a sister company and bills it
    Given an accepted quotation
    And a sister company of the same holding
    And the PO has reached "ON_PROGRESS"
    When the user moves the PO to the sister company with its narahubung
    Then the response status is 200
    When the user reads the PO by quotation
    Then the PO belongs to the sister company
    And the PO history ends with "ON_PROGRESS" to "ON_PROGRESS" noting "Klien diganti dari PT. IMC Ship Management menjadi PT Saudara Holding ATDD"
    When the user transitions the PO through "DELIVERED"
    Then every PO transition succeeds
    When the user reads the invoice by quotation
    Then the invoice bills the sister company

  Scenario Outline: A delivered or cancelled PO keeps its client
    Given an accepted quotation
    And a sister company of the same holding
    And the PO has reached "<status>"
    When the user moves the PO to the sister company with its narahubung
    Then the PO is refused as locked with "Klien PO yang sudah Dikirim atau Dibatalkan tidak dapat diganti."

    Examples:
      | status    |
      | DELIVERED |
      | CANCELLED |

  Scenario: The PO number must be free under the new client
    Given an accepted quotation
    And a sister company of the same holding
    And the sister company already has a PO numbered like this one
    When the user moves the PO to the sister company with its narahubung
    Then the response status is 422
    And the field "clientId" says "sudah dipakai PO lain milik klien tersebut"

  Scenario: A narahubung of another client is refused
    Given an accepted quotation
    And a sister company of the same holding
    When the user moves the PO to the sister company with the first client's narahubung
    Then the response status is 422
    And the field "contactId" says "bukan milik klien ini"

  Scenario: A stale version is refused
    Given an accepted quotation
    And a sister company of the same holding
    When the user moves the PO to the sister company with a stale If-Match
    Then the response status is 409

  Scenario: Operational input cannot move the PO
    Given an accepted quotation
    And a sister company of the same holding
    And a signed-in "operational_input" user
    When that user moves the PO to the sister company
    Then the response status is 403
