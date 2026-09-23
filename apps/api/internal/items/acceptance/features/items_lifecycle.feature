Feature: Item lifecycle
  Operations team must register, search, update and link
  catalog items to vendors with cost prices.

  Background:
    Given an authenticated user with id 1

  Scenario: Create item with valid payload
    When the user creates an item
    Then the response status is 201
    And the response contains an item id

  Scenario: Reject create with empty name
    When the user creates an item with empty name
    Then the response status is 422

  Scenario: Read item detail
    Given an existing item
    When the user reads the item
    Then the response status is 200
    And the item name matches the seeded value

  Scenario: Update item rename
    Given an existing item
    When the user updates the item name
    Then the response status is 200
    When the user reads the item
    And the item name reflects the update

  Scenario: Search returns the seeded item
    Given an existing item
    When the user searches items by the seeded name
    Then the response status is 200
    And the item search results contain the seeded item

  Scenario: Match request fuzzy resolves item
    Given an existing item
    When the user matches a request that mentions the seeded name
    Then the response status is 200
    And the match results contain at least 1 candidate

  Scenario: Reject match request with empty text
    When the user matches a request with empty text
    Then the response status is 422

  Scenario: Link vendor to item
    Given an existing item
    When the user links vendor 1 to the item
    Then the response status is 201
    When the user lists vendors for the item
    Then the response status is 200
    And the vendor list contains at least 1 row

  Scenario: Import auto-creates a product for an unmatched row
    When the user imports an unknown product row with auto-create
    Then the response status is 200
    And the imported row is a newly created product with empty price

  Scenario: Import match skips a deactivated vendor's cheaper price
    Given an existing item with an IMPA code
    And the item is offered at 100 by a vendor that is later deactivated
    And the item is offered at 200 by an active vendor
    When the user imports a row with the item's IMPA code
    Then the response status is 200
    And the imported row carries the active vendor's price of "200.00"

  Scenario: A lowercase IMPA code matches on import
    Given an existing item with an IMPA code
    When the user imports a row with the item's IMPA code in lowercase and auto-create
    Then the response status is 200
    And the imported row matched the seeded item by IMPA code

  Scenario: A duplicate active IMPA code returns 409
    Given an existing item with an IMPA code
    When the user creates another item with the same IMPA code
    Then the response status is 409

  Scenario: Linking an inactive vendor returns 422
    Given an existing item
    When the user links an inactive vendor to the item
    Then the response status is 422

  Scenario Outline: Whitespace-only names are rejected on create
    When the user creates an item named "<name>"
    Then the response status is 422

    Examples:
      | name |
      |      |
      | \t   |

  Scenario Outline: A search with LIKE wildcards matches literally
    Given an item named with "<wildcard>" and a decoy without it
    When the user lists items searching for the literal name
    Then the response status is 200
    And the list holds only the item with the wildcard

    Examples:
      | wildcard |
      | %        |
      | _        |

  Scenario: A search with a NUL byte returns 400
    When the user sends GET "/items/?q=bolt%00nut"
    Then the response status is 400

  Scenario: An invalid unitId filter returns 400
    When the user sends GET "/items/?unitId=pcs"
    Then the response status is 400

  Scenario Outline: A sub-collection of a missing item returns 404
    When the user sends GET "/items/999999999/<collection>"
    Then the response status is 404

    Examples:
      | collection    |
      | vendors       |
      | price-history |
