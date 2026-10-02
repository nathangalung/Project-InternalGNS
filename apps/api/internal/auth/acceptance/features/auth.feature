Feature: Login, session refresh and session revocation
  Every role signs in with email and password, keeps its session alive with
  a rotating refresh token held in an HttpOnly cookie, and loses it the
  moment an administrator changes the account behind it. The cookie routes
  answer only the listed SPA origin, and only with the CSRF header.

  Background:
    Given an active "operational" account

  Scenario: Login returns an access token and sets the refresh cookie
    When the account logs in with the right password
    Then the response status is 200
    And the response carries an access token and no refresh token
    And the refresh cookie is HttpOnly, Secure, SameSite=Strict and scoped to "/api/v1/auth"
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
    When someone logs in as one unknown email 11 times from one address
    Then the response status is 429
    And the response is problem+json

  Scenario: An office signs in from one address
    When 6 colleagues log in with the right password from one address
    Then the response status is 200

  Scenario: Refresh rotates the token and the old one is single-use
    Given the account is logged in
    When the account refreshes its session
    Then the response status is 200
    And the refresh token was rotated
    And the response carries an access token and no refresh token
    And the refresh cookie is HttpOnly, Secure, SameSite=Strict and scoped to "/api/v1/auth"
    When the account refreshes its session
    Then the response status is 200

  Scenario: Replaying a rotated refresh token ends every session
    Given the account is logged in
    And the account refreshed its session
    And the revocations happened 30 seconds ago
    When the account replays the first refresh token
    Then the response status is 401
    And the problem detail is "Token penyegar sudah pernah dipakai. Silakan masuk kembali."
    And the refresh cookie is cleared
    When the account refreshes its session
    Then the response status is 401

  Scenario: A second tab losing the rotation race keeps the session
    Given the account is logged in
    And the account refreshed its session
    When the account replays the first refresh token
    Then the response status is 401
    And the problem detail is "Token penyegar sudah pernah dipakai. Silakan masuk kembali."
    And the refresh cookie is left alone
    When the account refreshes its session
    Then the response status is 200

  Scenario: A refresh token an admin revoked does not end a newer session
    Given the account is logged in
    And a superadmin changed the account role to "finance"
    And the revocations happened 30 seconds ago
    And the account logged in again
    When the account replays the first refresh token
    Then the response status is 401
    And the problem detail is "Sesi Anda sudah diakhiri. Silakan masuk kembali."
    When the account refreshes its session
    Then the response status is 200

  Scenario: A deactivated user's access token is rejected immediately
    Given the account is logged in
    When a superadmin deactivates the account
    Then the response status is 200
    When the account calls "/api/v1/auth/me"
    Then the response status is 401
    And the problem detail is "Sesi Anda tidak berlaku lagi. Silakan masuk kembali."
    When the account refreshes its session
    Then the response status is 401

  Scenario: A request without an access token is told to sign in
    When someone calls "/api/v1/auth/me" without a token
    Then the response status is 401
    And the problem detail is "Anda belum masuk. Silakan masuk terlebih dahulu."

  Scenario: A role change ends the existing access token
    Given the account is logged in
    When a superadmin changes the account role to "finance"
    And the account calls "/api/v1/auth/me"
    Then the response status is 401
    And the problem detail is "Sesi Anda tidak berlaku lagi. Silakan masuk kembali."
    When the account refreshes its session
    Then the response status is 401

  Scenario Outline: The next login carries the new role
    Given the account is logged in
    When a superadmin changes the account role to "<role>"
    And the account logged in again
    And the account calls "<path>"
    Then the response status is <status>

    Examples:
      | role        | path                      | status |
      | finance     | /api/v1/quotations/       | 403    |
      | finance     | /api/v1/invoices/         | 200    |
      | operational | /api/v1/quotations/       | 200    |

  Scenario: Keeping the same role keeps the session
    Given the account is logged in
    When a superadmin changes the account role to "operational"
    And the account calls "/api/v1/auth/me"
    Then the response status is 200

  Scenario: An admin password reset ends the existing access token
    Given the account is logged in
    When a superadmin resets the account password to "Baru-pw2@"
    And the account calls "/api/v1/auth/me"
    Then the response status is 401

  Scenario: Any role changes its own password and signs in again
    Given the account is logged in
    When the account changes its own password to "Baru-pw2@"
    Then the response status is 204
    And the refresh cookie is cleared
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

  Scenario: Logging out ends the refresh token
    Given the account is logged in
    When the account logs out
    Then the response status is 204
    And the refresh cookie is cleared
    When the account refreshes its session
    Then the response status is 401
    And the problem detail is "Sesi Anda sudah diakhiri. Silakan masuk kembali."

  Scenario: An expired refresh token asks for a new sign-in
    Given the account is logged in
    And the refresh token expired a minute ago
    When the account refreshes its session
    Then the response status is 401
    And the problem detail is "Sesi Anda sudah berakhir. Silakan masuk kembali."
    And the refresh cookie is cleared

  Scenario: An unknown refresh token is refused
    When someone refreshes with the token "not-a-real-token"
    Then the response status is 401
    And the problem detail is "Token penyegar tidak valid. Silakan masuk kembali."
    And the refresh cookie is cleared

  Scenario: A refresh without the cookie is told to sign in
    When someone refreshes with the token ""
    Then the response status is 401
    And the problem detail is "Anda belum masuk. Silakan masuk terlebih dahulu."

  Scenario: A refresh token in the body is ignored
    Given the account is logged in
    When the account sends its refresh token in the body instead of the cookie
    Then the response status is 401
    And the problem detail is "Anda belum masuk. Silakan masuk terlebih dahulu."
    When the account refreshes its session
    Then the response status is 200

  Scenario Outline: A cookie route refuses what a foreign page could send
    Given the account is logged in
    When the account posts to "<route>" <how>
    Then the response status is 403
    And the problem detail is "<detail>"
    When the account refreshes its session
    Then the response status is 200

    Examples:
      | route                | how                                   | detail                                                  |
      | /api/v1/auth/refresh | from the origin "https://evil.example" | Permintaan ditolak karena asal halaman tidak diizinkan. |
      | /api/v1/auth/refresh | without an Origin                     | Permintaan ditolak karena asal halaman tidak diizinkan. |
      | /api/v1/auth/refresh | without the CSRF header               | Permintaan ditolak karena header keamanan tidak ada.    |
      | /api/v1/auth/logout  | from the origin "https://evil.example" | Permintaan ditolak karena asal halaman tidak diizinkan. |
      | /api/v1/auth/logout  | without the CSRF header               | Permintaan ditolak karena header keamanan tidak ada.    |

  Scenario Outline: Login refuses what a foreign page could send
    When the account logs in from the origin "<origin>" as "<type>"
    Then the response status is <status>
    And the problem detail is "<detail>"
    And the refresh cookie is left alone

    Examples:
      | origin               | type                              | status | detail                                                  |
      | https://evil.example | application/json                  | 403    | Permintaan ditolak karena asal halaman tidak diizinkan. |
      | https://evil.example | text/plain                        | 403    | Permintaan ditolak karena asal halaman tidak diizinkan. |
      | null                 | application/json                  | 403    | Permintaan ditolak karena asal halaman tidak diizinkan. |
      | http://spa.test      | text/plain                        | 415    | Permintaan masuk harus berformat JSON.                  |
      | http://spa.test      | application/x-www-form-urlencoded | 415    | Permintaan masuk harus berformat JSON.                  |

  Scenario: Login from the listed origin sets the refresh cookie
    When the account logs in from the origin "http://spa.test" as "application/json"
    Then the response status is 200
    And the refresh cookie is HttpOnly, Secure, SameSite=Strict and scoped to "/api/v1/auth"

  Scenario: Only the listed origin gets credentialed CORS
    When a page at "https://evil.example" preflights "/api/v1/auth/refresh"
    Then the response grants no credentials
    When a page at "http://spa.test" preflights "/api/v1/auth/refresh"
    Then the response grants credentials to "http://spa.test"

  Scenario: A forged access token is refused
    Given the account is logged in
    When the account calls "/api/v1/auth/me" with its token signed by another key
    Then the response status is 401
    And the problem detail is "Token akses tidak valid atau sudah kedaluwarsa. Silakan masuk kembali."

  Scenario: A login with a malformed body is a bad request
    When someone posts to "/api/v1/auth/login":
      """
      {"email":
      """
    Then the response status is 400
    And the response is problem+json

  Scenario: A login without credentials names both fields
    When someone posts to "/api/v1/auth/login":
      """
      {}
      """
    Then the response status is 422
    And the problem detail is "Email wajib diisi.; Kata sandi wajib diisi."

  Scenario Outline: Only a superadmin reaches user management
    Given a logged-in "<role>" account
    When the account calls "/api/v1/users/"
    Then the response status is <status>

    Examples:
      | role        | status |
      | operational | 403    |
      | finance     | 403    |
      | superadmin  | 200    |

  Scenario Outline: A refused role is told why
    Given a logged-in "<role>" account
    When the account calls "/api/v1/users/"
    Then the problem detail is "Peran Anda tidak memiliki akses ke fitur ini."

    Examples:
      | role        |
      | operational |
      | finance     |
