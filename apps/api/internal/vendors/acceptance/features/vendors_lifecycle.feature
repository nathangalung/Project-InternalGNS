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
