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

  Scenario: Clearing contact email and title removes them
    Given an existing client
    And the client has a contact with an email and a title
    When the user clears the contact email and title
    Then the response status is 200
    And the contact has no email and no title

  Scenario: Editing a deleted contact returns 404
    Given an existing client
    And the client has a contact with an email and a title
    When the user deletes the contact
    Then the response status is 204
    When the user renames the contact
    Then the response status is 404

  Scenario: A deleted contact's email can be reused
    Given an existing client
    And the client has a contact with an email and a title
    When the user deletes the contact
    And another client adds a contact with the same email
    Then the response status is 201

  Scenario: Logo PATCH rejects a key outside the entity prefix
    Given an existing client
    When the user attaches a logo stored under another client
    Then the response status is 422

  Scenario: A client created without a number gets one assigned
    When the user creates a client without a number
    Then the response status is 201
    And the response assigns a four digit client number

  Scenario: A blank client number is assigned by the server
    When the user creates a client with number ""
    Then the response status is 201
    And the response assigns a four digit client number

  Scenario: A free text client number is rejected
    When the user creates a client with number "REF-ABC"
    Then the response status is 422
    And the client number error reads "Nomor klien harus 4 digit dan belum dipakai."

  Scenario: A client number already in use is rejected
    Given an existing client
    When the user creates a client with the existing client's number
    Then the response status is 422
    And the client number error reads "Nomor klien harus 4 digit dan belum dipakai."

  Scenario: The client number is fixed once a quotation uses it
    Given an existing client
    And a quotation references the client
    When the user changes the client number
    Then the response status is 422
    And the client number error reads "Nomor klien tidak dapat diubah karena sudah dipakai pada penawaran."

  Scenario Outline: Whitespace-only names are rejected on create and update
    Given an existing client
    When the user creates a client named with only <blank>
    Then the response status is 422
    When the user renames the client to only <blank>
    Then the response status is 422
    When the user reads the client
    Then the client name matches the seeded value

    Examples:
      | blank    |
      | spaces   |
      | a tab    |
      | newlines |

  Scenario Outline: A search with LIKE wildcards matches literally
    Given a client named with "<wildcard>" and a decoy without it
    When the user lists clients searching for the literal name
    Then the response status is 200
    And the client list holds only the client with the wildcard

    Examples:
      | wildcard |
      | %        |
      | _        |

  Scenario Outline: A search with a NUL byte returns 400
    When the user sends GET "<path>"
    Then the response status is 400

    Examples:
      | path                       |
      | /clients/?q=pt%00maju      |
      | /clients/search?q=pt%00    |
      | /clients/?countryCode=%ff  |

  Scenario Outline: Contacts of a missing client return 404
    When the user sends <method> "/clients/999999999/contacts"
    Then the response status is 404

    Examples:
      | method |
      | GET    |
      | POST   |

  Scenario Outline: A contact cannot be changed through another client
    Given an existing client
    And the client has a contact with an email and a title
    When another client <method>s the contact
    Then the response status is 404
    And the contact is still listed unchanged

    Examples:
      | method |
      | PATCH  |
      | DELETE |

  Scenario: A new active client moves the summary
    Given the client summary is noted
    When the user creates a client
    Then the response status is 201
    When the user reads client summary
    Then the summary grew by 1 active client this month
