Feature: User management lifecycle
  Superadmin must register staff accounts, edit profile,
  and reset passwords with the role enum enforced.

  Background:
    Given an authenticated user with id 1

  Scenario: Create user with valid payload
    When the user creates a staff account
    Then the response status is 201
    And the response contains a user id

  Scenario: Reject create with empty email
    When the user creates a staff account with empty email
    Then the response status is 422

  Scenario: Reject create with weak password
    When the user creates a staff account with password "short"
    Then the response status is 422

  Scenario: Reject create with invalid role
    When the user creates a staff account with role "invalid"
    Then the response status is 422

  Scenario: Reject duplicate email
    Given an existing staff account
    When the user creates a staff account with the seeded email
    Then the response status is 409

  Scenario: Read user detail
    Given an existing staff account
    When the user reads the staff account
    Then the response status is 200
    And the user email matches the seeded value

  Scenario: Update user name
    Given an existing staff account
    When the user updates the staff name
    Then the response status is 200
    When the user reads the staff account
    Then the response status is 200
    And the user name reflects the update

  Scenario: Change password succeeds
    Given an existing staff account
    When the user changes the password to "newpass1234"
    Then the response status is 204

  Scenario: Change password rejects weak input
    Given an existing staff account
    When the user changes the password to "short"
    Then the response status is 422

  Scenario: List filters by role
    Given an existing staff account
    When the user lists staff filtered by role "operational"
    Then the response status is 200
    And the staff list contains at least 1 row
