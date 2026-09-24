Feature: Quotation edges and access
  The quotation API refuses bad input with a clear 4xx, keeps what an
  edit sends, prints the delivery terms, scopes nested resources to their
  quotation, and is closed to finance.

  Background:
    Given an authenticated user with id 1
    And the quotation domain is empty

  Scenario: The PDF prints the delivery place and the shipping days
    Given a draft quotation for vessel "MV GLOBAL STAR" shipped in 5 days
    When the user downloads the quotation PDF
    Then the PDF prints "DELIVERY PLACE : MV GLOBAL STAR"
    And the PDF prints "DELIVERY TIME : 5 days"

  # PUT replaces the header: a field left out is cleared, so the edit
  # screen must send vessel and notes back (Q-11).
  Scenario Outline: An edit keeps only the vessel and notes it sends
    Given a draft quotation for vessel "MV GLOBAL STAR" shipped in 5 days
    When the user edits the quotation <sending> vessel and notes
    Then the response status is 200
    And the quotation vessel is "<vessel>" and its notes are "<notes>"

    Examples:
      | sending     | vessel         | notes      |
      | resending   | MV GLOBAL STAR | Kirim pagi |
      | leaving out |                |            |

  Scenario Outline: A price or quantity below zero is refused
    When the user creates a quotation whose line has qty "<qty>" and price "<price>"
    Then the response status is 422
    And no quotation was stored

    Examples:
      | qty | price  |
      | -1  | 10000  |
      | 1   | -10000 |

  Scenario Outline: An unknown quotation is not found
    When the user <action> quotation 9999999
    Then the response status is 404
    And the problem detail mentions "Quotation 9999999 tidak ditemukan."

    Examples:
      | action  |
      | sends   |
      | cancels |

  Scenario Outline: A bad date filter is the caller's error
    Given an existing draft quotation
    When the user lists quotations with "<query>"
    Then the response status is <code>

    Examples:
      | query                                 | code |
      | dateFrom=2000-01-01&dateTo=2099-12-31 | 200  |
      | dateFrom=kemarin                      | 422  |
      | dateTo=2026-02-30                     | 422  |

  Scenario: An item request is reachable only under its own quotation
    Given two draft quotations and an item request on the first
    When the user edits that request through the second quotation
    Then the response status is 404
    When the user deletes that request through the second quotation
    Then the response status is 404
    And the item request on the first quotation is unchanged

  Scenario: The contact can move to another contact of the same client only
    Given an existing draft quotation
    When the user changes the contact to one of another client
    Then the response status is 422
    And the problem names the field "contactId"
    When the user changes the contact to another contact of the same client
    Then the response status is 204
    And the quotation contact is that contact

  Scenario Outline: Finance is refused every quotation endpoint
    Given an existing draft quotation
    When a "<role>" user calls <method> "<path>" through the API
    Then the response status is <code>

    Examples:
      | role        | method | path                           | code |
      | finance     | GET    | /quotations                    | 403  |
      | finance     | GET    | /quotations/stats              | 403  |
      | finance     | GET    | /quotations/export.xlsx        | 403  |
      | finance     | GET    | /quotations/{id}               | 403  |
      | finance     | GET    | /quotations/{id}/revisions     | 403  |
      | finance     | GET    | /quotations/{id}/requests      | 403  |
      | finance     | POST   | /quotations                    | 403  |
      | finance     | PUT    | /quotations/{id}               | 403  |
      | finance     | POST   | /quotations/{id}/send          | 403  |
      | finance     | PATCH  | /quotations/{id}/contact       | 403  |
      | finance     | GET    | /quotations/{id}/pdf           | 403  |
      | operational | GET    | /quotations                    | 200  |
      | operational | GET    | /quotations/{id}               | 200  |
      | superadmin  | GET    | /quotations/{id}/requests      | 200  |
