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
    When the user changes the password to "Newpass1234!"
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

  Scenario: Reject create with a malformed email
    When the user creates a staff account with email "SCOUT-not-an-email"
    Then the response status is 422

  Scenario Outline: Reject passwords the policy refuses
    When the user creates a staff account with password "<password>"
    Then the response status is 422

    Examples:
      | password  |
      | aaaaaaaa  |
      | Rahasia1  |
      | rahasia1! |
      | Rah1!     |

  Scenario: Reject a password over 72 bytes
    When the user creates a staff account with an oversized password
    Then the response status is 422

  Scenario: Update to an email another account holds returns conflict
    Given an existing staff account
    And a second staff account
    When the user updates the second account to the first email
    Then the response status is 409

  Scenario: An inactive account stays readable and can be reactivated
    Given an existing staff account
    When the user deactivates the staff account
    Then the response status is 200
    When the user reads the staff account
    Then the response status is 200
    And the staff account is inactive
    When the user reactivates the staff account
    Then the response status is 200
    And the staff account is active

  Scenario: Names are stored trimmed
    When the user creates a staff account with a padded name
    Then the response status is 201
    And the user name has no padding
