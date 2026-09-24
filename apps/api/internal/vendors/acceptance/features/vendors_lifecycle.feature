Feature: Vendor lifecycle
  Operations team must register, search and update vendors
  and inspect catalog items linked to each vendor.

  Background:
    Given an authenticated user with id 1

  Scenario: Create vendor with valid payload
    When the user creates a vendor
    Then the response status is 201
    And the response contains a vendor id

  Scenario: Reject create with empty name
    When the user creates a vendor with empty name
    Then the response status is 422

  Scenario: Read vendor detail
    Given an existing vendor
    When the user reads the vendor
    Then the response status is 200
    And the vendor name matches the seeded value

  Scenario: Update vendor name
    Given an existing vendor
    When the user updates the vendor name
    Then the response status is 200
    When the user reads the vendor
    Then the response status is 200
    And the vendor name reflects the update

  Scenario: Search returns the seeded vendor
    Given an existing vendor
    When the user searches vendors by the seeded name
    Then the response status is 200
    And the vendor search results contain the seeded vendor

  Scenario: List items for seeded vendor
    When the user lists items for vendor 1
    Then the response status is 200
    And the items list contains at least 1 row

  Scenario Outline: Whitespace-only names are rejected on create and update
    Given an existing vendor
    When the user creates a vendor named with only <blank>
    Then the response status is 422
    When the user renames the vendor to only <blank>
    Then the response status is 422
    When the user reads the vendor
    Then the vendor name matches the seeded value

    Examples:
      | blank    |
      | spaces   |
      | a tab    |
      | newlines |

  Scenario Outline: A search with LIKE wildcards matches literally
    Given a vendor named with "<wildcard>" and a decoy without it
    When the user lists vendors searching for the literal name
    Then the response status is 200
    And the vendor list holds only the vendor with the wildcard

    Examples:
      | wildcard |
      | %        |
      | _        |

  Scenario Outline: Unstorable query text returns 400
    When the user sends GET "<path>"
    Then the response status is 400

    Examples:
      | path                           |
      | /vendors/?q=cv%00maju          |
      | /vendors/search?q=cv%00        |
      | /vendors/?countryName=%ff%fe   |

  Scenario: Products of a missing vendor return 404
    When the user sends GET "/vendors/999999999/items"
    Then the response status is 404

  Scenario: Logo PATCH rejects a key outside the entity prefix
    Given an existing vendor
    When the user attaches a logo stored under another vendor
    Then the response status is 422

  Scenario: The vendor product list pages past 50 with its real total
    Given a vendor offering 51 products
    When the user lists the vendor's products with "limit=50"
    Then the response status is 200
    And the page holds 50 products of 51
    When the user lists the vendor's products with "limit=50&offset=50"
    Then the response status is 200
    And the page holds 1 product of 51
    When the user lists the vendor's products with ""
    Then the response status is 200
    And the page holds 50 products of 51
