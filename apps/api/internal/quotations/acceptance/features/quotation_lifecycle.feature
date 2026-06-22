Feature: Quotation lifecycle
  Operations team must move a quotation through draft, sent,
  accepted, rejected, revision and expired states under defined rules.

  Background:
    Given an authenticated user with id 1
    And the quotation domain is empty

  Scenario: Create draft quotation succeeds
    When the user creates a quotation with discount 10 percent and 1 product line
    Then the response status is 201
    And the response contains a quotation id

  Scenario: Reject create with no items
    When the user creates a quotation with no items
    Then the response status is 422

  Scenario: Reject create with invalid discount
    When the user creates a quotation with discount 200 percent and 1 product line
    Then the response status is 422

  Scenario: Send a draft and read its detail
    Given an existing draft quotation
    When the user sends the quotation
    Then the response status is 204
    When the user reads the quotation
    Then the response status is 200
    And the quotation status is "sent"

  Scenario: Cannot send a quotation with an unpriced product line
    When the user creates a quotation with an unpriced product line
    And the user sends the quotation
    Then the response status is 422

  Scenario Outline: Valid status transitions
    Given an existing draft quotation
    When the user transitions the quotation through "<path>"
    Then every transition succeeds

    Examples:
      | path                              |
      | sent,accepted                     |
      | sent,rejected                     |
      | sent,revision,sent                |
      | sent,revision,rejected            |
      | expired                           |

  Scenario: Cannot exit accepted state
    Given an existing draft quotation
    When the user transitions the quotation through "sent,accepted"
    And the user tries to transition the quotation to "sent"
    Then the response status is 422

  Scenario: List filters return matching rows
    Given an existing draft quotation
    When the user lists quotations filtered by status "draft"
    Then the response status is 200
    And the list contains at least 1 quotation
