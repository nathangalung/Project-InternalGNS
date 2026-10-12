Feature: Change a draft's client
  An RFQ can be quoted to another company of the same holding. A draft
  moves to that client with its own narahubung, as part of the header
  claim, and keeps its lines, prices and the client's reference. A
  quotation past draft already reached the client, so it moves only
  through Buat Revisi, whose draft can move.

  Background:
    Given an authenticated user with id 1
    And the quotation domain is empty

  Scenario: A draft moves to a sister company
    Given an existing draft quotation
    And a sister company of the same holding
    And the user claims the header
    When the user moves the quotation to the sister company with its narahubung
    Then the response status is 204
    And the quotation names the sister company and its narahubung
    And the quotation history ends noting "Klien diganti dari PT. IMC Ship Management menjadi PT Saudara Holding QATDD"

  Scenario: The move needs the header claim
    Given an existing draft quotation
    And a sister company of the same holding
    When the user moves the quotation to the sister company with its narahubung
    Then the response status is 409
    And the problem detail mentions "Waktu mengubah bagian ini sudah habis"

  Scenario: A sent quotation moves only through a revision
    Given an existing draft quotation
    And a sister company of the same holding
    And the user transitions the quotation through "sent"
    When the user moves the quotation to the sister company with its narahubung
    Then the response status is 409
    And the problem detail mentions "buat revisi lalu ganti kliennya di draf revisi"
    When the user revises the quotation
    And the user claims the header of the new revision
    And the user moves the new revision to the sister company
    Then the response status is 204
    And the original quotation keeps its client

  Scenario: A narahubung of another client is refused
    Given an existing draft quotation
    And a sister company of the same holding
    And the user claims the header
    When the user moves the quotation to the sister company with the first client's narahubung
    Then the response status is 422
    And the problem names the field "contactId"

  Scenario Outline: Only the draft writers move a draft
    Given an existing draft quotation
    When a "<role>" user calls PATCH "/quotations/{id}/client" through the API
    Then the response status is <code>

    Examples:
      | role              | code |
      | finance           | 403  |
      | finance_input     | 403  |
      | operational_input | 422  |
      | operational       | 422  |
