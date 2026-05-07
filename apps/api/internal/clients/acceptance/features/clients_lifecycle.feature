Feature: Client lifecycle
  Operations team must register, search and update company clients
  with at least one active contact.

  Background:
    Given an authenticated user with id 1

  Scenario: Create client with valid payload
    When the user creates a client
    Then the response status is 201
    And the response contains a client id

  Scenario: Reject create with empty name
    When the user creates a client with empty name
    Then the response status is 422

  Scenario: Read client detail
    Given an existing client
    When the user reads the client
    Then the response status is 200
    And the client name matches the seeded value

  Scenario: Update client name
    Given an existing client
    When the user updates the client name
    Then the response status is 200
    When the user reads the client
    Then the response status is 200
    And the client name reflects the update

  Scenario: Search returns the seeded client
    Given an existing client
    When the user searches clients by the seeded name
    Then the response status is 200
    And the search results contain the seeded client

  Scenario: Add contact to client
    Given an existing client
    When the user adds a contact named "Budi"
    Then the response status is 201
    When the user lists client contacts
    Then the response status is 200
    And the contact list contains at least 1 row

  Scenario: Reject contact create with empty name
    Given an existing client
    When the user adds a contact with empty name
    Then the response status is 422

  Scenario: Summary endpoint returns aggregates
    Given an existing client
    When the user reads client summary
    Then the response status is 200
    And the client summary total is at least 1
