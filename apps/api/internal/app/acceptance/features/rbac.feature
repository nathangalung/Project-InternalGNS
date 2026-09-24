Feature: Role gates at the router mounts
  Quotations and purchase orders belong to superadmin and operational,
  invoices to superadmin and finance, and user management to superadmin
  alone. Finance reads the catalog and vendors but does not change them.
  Everyone reaches the shared master data. The gate sits at the mount, so
  it answers before any handler looks at the request, and it answers in
  Indonesian like every other refusal.

  Scenario Outline: A role outside a mount is refused, whatever the method
    Given I am signed in as "<role>"
    When I send "<method>" to "<path>"
    Then the response status is 403
    And the problem detail is "Peran Anda tidak memiliki akses ke fitur ini."

    Examples: quotations refuse finance
      | role    | method | path                                  |
      | finance | GET    | /api/v1/quotations/                   |
      | finance | POST   | /api/v1/quotations/                   |
      | finance | GET    | /api/v1/quotations/export.xlsx        |
      | finance | PUT    | /api/v1/quotations/999999             |
      | finance | PATCH  | /api/v1/quotations/999999/status      |
      | finance | POST   | /api/v1/quotations/999999/send        |
      | finance | GET    | /api/v1/quotations/999999/pdf         |

    Examples: purchase orders refuse finance
      | role    | method | path                                      |
      | finance | GET    | /api/v1/purchase-orders/                  |
      | finance | GET    | /api/v1/purchase-orders/export.xlsx       |
      | finance | GET    | /api/v1/purchase-orders/999999            |
      | finance | PATCH  | /api/v1/purchase-orders/999999/status     |
      | finance | PATCH  | /api/v1/purchase-orders/999999/details    |
      | finance | GET    | /api/v1/purchase-orders/999999/upload-url |

    Examples: invoices refuse operational
      | role        | method | path                                          |
      | operational | GET    | /api/v1/invoices/                             |
      | operational | GET    | /api/v1/invoices/summary                      |
      | operational | GET    | /api/v1/invoices/coretax.xlsx                 |
      | operational | GET    | /api/v1/invoices/999999                       |
      | operational | PATCH  | /api/v1/invoices/999999/status                |
      | operational | PATCH  | /api/v1/invoices/999999/dates                 |
      | operational | GET    | /api/v1/invoices/999999/payment-proof/upload-url |

    Examples: user management refuses everyone but superadmin
      | role        | method | path                           |
      | finance     | GET    | /api/v1/users/                 |
      | finance     | POST   | /api/v1/users/                 |
      | finance     | PATCH  | /api/v1/users/1/password       |
      | operational | GET    | /api/v1/users/1                |
      | operational | PUT    | /api/v1/users/1                |

    Examples: finance reads but does not change the catalog and vendors
      | role    | method | path                                               |
      | finance | POST   | /api/v1/items/                                     |
      | finance | PUT    | /api/v1/items/999999                               |
      | finance | POST   | /api/v1/items/match-rows                           |
      | finance | GET    | /api/v1/items/999999/image/upload-url?fileName=a.png |
      | finance | POST   | /api/v1/vendors/                                   |
      | finance | PATCH  | /api/v1/vendors/999999/logo                        |

  Scenario Outline: A role inside a mount gets past the gate
    Given I am signed in as "<role>"
    When I send "GET" to "<path>"
    Then the response status is 200

    Examples:
      | role        | path                      |
      | superadmin  | /api/v1/quotations/       |
      | operational | /api/v1/quotations/       |
      | superadmin  | /api/v1/purchase-orders/  |
      | operational | /api/v1/purchase-orders/  |
      | superadmin  | /api/v1/invoices/         |
      | finance     | /api/v1/invoices/         |
      | superadmin  | /api/v1/users/            |
      | finance     | /api/v1/items/            |
      | finance     | /api/v1/vendors/          |

  Scenario Outline: Every role reaches the shared master data
    Given I am signed in as "<role>"
    When I send "GET" to "<path>"
    Then the response status is 200

    Examples:
      | role        | path                         |
      | operational | /api/v1/clients/             |
      | operational | /api/v1/items/               |
      | operational | /api/v1/vendors/             |
      | finance     | /api/v1/clients/             |
      | finance     | /api/v1/units/               |
      | finance     | /api/v1/countries/           |
      | operational | /api/v1/dashboard/summary    |
      | finance     | /api/v1/dashboard/summary    |

  Scenario: A refused create stores nothing
    Given I am signed in as "operational"
    When I create a user with a fresh email
    Then the response status is 403
    And no user with that email exists

  Scenario: The same create passes the gate for a superadmin
    Given I am signed in as "superadmin"
    When I create a user with a fresh email
    Then the response status is 201
    And a user with that email exists

  Scenario Outline: Without a session the sign-in check answers before the role gate
    Given I am not signed in
    When I send "GET" to "<path>"
    Then the response status is 401
    And the problem detail is "Anda belum masuk. Silakan masuk terlebih dahulu."

    Examples:
      | path                     |
      | /api/v1/quotations/      |
      | /api/v1/purchase-orders/ |
      | /api/v1/invoices/        |
      | /api/v1/users/           |
