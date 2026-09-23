Feature: Login, session refresh and session revocation
  Every role signs in with email and password, keeps its session alive with
  a rotating refresh token, and loses it the moment an administrator changes
  the account behind it.

  Background:
    Given an active "operational" account

  Scenario: Login with valid credentials returns an access and refresh token
    When the account logs in with the right password
    Then the response status is 200
    And the response carries an access and a refresh token
    When the account calls "/api/v1/auth/me"
    Then the response status is 200

  Scenario: Login with a wrong password returns the neutral 401
    When the account logs in with a wrong password
    Then the response status is 401
    And the problem detail is "Email atau kata sandi salah."

  Scenario: An unknown email gets the same answer as a wrong password
    When someone logs in as an unknown email
    Then the response status is 401
    And the problem detail is "Email atau kata sandi salah."

  Scenario: A throttled account answers the same 401 and still takes the right password
    Given the account has failed to log in 6 times
    When the account logs in with a wrong password
    Then the response status is 401
    And the problem detail is "Email atau kata sandi salah."
    When the account logs in with the right password
    Then the response status is 200

  Scenario: An admin password reset clears the throttle
    Given the account has failed to log in 6 times
    When a superadmin resets the account password to "Baru-pw2@"
    Then the response status is 204
    And the account has no failed login attempts

  Scenario: A rate-limited login answers problem+json
    When the account logs in with a wrong password 6 times from one address
    Then the response status is 429
    And the response is problem+json

  Scenario: Refresh rotates the token and the old one is single-use
    Given the account is logged in
    When the account refreshes its session
    Then the response status is 200
    And the refresh token was rotated
    When the account refreshes its session
    Then the response status is 200

  Scenario: Replaying a rotated refresh token ends every session
    Given the account is logged in
    And the account refreshed its session
    And the revocations happened 30 seconds ago
    When the account replays the first refresh token
    Then the response status is 401
    When the account refreshes its session
    Then the response status is 401

  Scenario: A refresh token an admin revoked does not end a newer session
    Given the account is logged in
    And a superadmin changed the account role to "finance"
    And the revocations happened 30 seconds ago
    And the account logged in again
    When the account replays the first refresh token
    Then the response status is 401
    When the account refreshes its session
    Then the response status is 200

  Scenario: A deactivated user's access token is rejected immediately
    Given the account is logged in
    When a superadmin deactivates the account
    Then the response status is 200
    When the account calls "/api/v1/auth/me"
    Then the response status is 401
    When the account refreshes its session
    Then the response status is 401

  Scenario Outline: A role change reaches the existing access token
    Given the account is logged in
    When a superadmin changes the account role to "<role>"
    And the account calls "<path>"
    Then the response status is <status>

    Examples:
      | role        | path                      | status |
      | finance     | /api/v1/quotations/       | 403    |
      | finance     | /api/v1/invoices/         | 200    |
      | operational | /api/v1/quotations/       | 200    |

  Scenario: An admin password reset ends the existing access token
    Given the account is logged in
    When a superadmin resets the account password to "Baru-pw2@"
    And the account calls "/api/v1/auth/me"
    Then the response status is 401

  Scenario: Any role changes its own password and signs in again
    Given the account is logged in
    When the account changes its own password to "Baru-pw2@"
    Then the response status is 204
    When the account calls "/api/v1/auth/me"
    Then the response status is 401
    When the account logs in with the password "Baru-pw2@"
    Then the response status is 200
    When the account calls "/api/v1/auth/me"
    Then the response status is 200

  Scenario: A wrong current password is refused without ending the session
    Given the account is logged in
    When the account changes its own password with a wrong current password
    Then the response status is 422
    When the account calls "/api/v1/auth/me"
    Then the response status is 200

  Scenario: A self-service change racing an admin reset is refused and the reset stands
    Given the account is logged in
    When the account changes its own password to "Sendiri-pw3#" while a superadmin resets it to "Baru-pw2@"
    Then the response status is 409
    And the problem detail is "Kata sandi akun ini baru saja diubah di tempat lain. Masuk kembali dengan kata sandi terbaru."
    When the account logs in with the password "Sendiri-pw3#"
    Then the response status is 401
    When the account logs in with the password "Baru-pw2@"
    Then the response status is 200
