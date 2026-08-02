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
