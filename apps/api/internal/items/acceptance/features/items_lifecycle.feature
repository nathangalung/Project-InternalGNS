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

  Scenario: Import match skips a deactivated vendor's cheaper price
    Given an existing item with an IMPA code
    And the item is offered at 100 by a vendor that is later deactivated
    And the item is offered at 200 by an active vendor
    When the user imports a row with the item's IMPA code
    Then the response status is 200
    And the imported row carries the active vendor's price of "200.00"

  Scenario: A marked IMPA code matches on import
    Given an existing item with an IMPA code
    When the user imports a row with the item's IMPA code in its marked form and auto-create
    Then the response status is 200
    And the imported row matched the seeded item by IMPA code

  Scenario: A code no product holds is created under it, never matched by name
    Given an existing item with an IMPA code
    When the user imports a row with a new IMPA code and the item's name with auto-create
    Then the response status is 200
    And the imported row is a new product holding the new code

  Scenario: A code no product holds stays unmatched without auto-create
    Given an existing item with an IMPA code
    When the user imports a row with a new IMPA code and the item's name
    Then the response status is 200
    And the imported row is unmatched

  Scenario: A row without a code still matches by name
    Given an existing item with an IMPA code
    When the user imports a row with the item's name and no code
    Then the response status is 200
    And the imported row matched the seeded item by name

  Scenario: A code named in the request text is matched as the code
    Given an existing item with an IMPA code
    When the user imports a row whose text names the item's IMPA code
    Then the response status is 200
    And the imported row matched the seeded item by IMPA code
    And the imported request text no longer names the code

  Scenario: An import row with a code that is not six digits is refused
    When the user imports a row with the IMPA code "ABC"
    Then the response status is 422
    And the problem field "rows[0].impaCode" says "Baris 1. Kode IMPA harus 6 digit angka, misalnya 190105. Kosongkan bila tidak ada."

  Scenario Outline: A product code that is not six digits is refused
    When the user creates an item with the IMPA code "<code>"
    Then the response status is 422
    And the problem field "impaCode" says "Kode IMPA harus 6 digit angka, misalnya 190105. Kosongkan bila tidak ada."

    Examples:
      | code    |
      | 19010   |
      | 1901055 |
      | N/A     |

  Scenario: A product name keeps its own code once
    When the user creates an item whose name repeats its IMPA code
    Then the response status is 201
    And the stored name no longer names the code

  Scenario: A code typed as "-" means none
    When the user creates an item with the IMPA code "-"
    Then the response status is 201
    And the stored item has no IMPA code

  Scenario: A duplicate active IMPA code lands on the IMPA field
    Given an existing item with an IMPA code
    When the user creates another item with the same IMPA code
    Then the response status is 422
    And the problem field "impaCode" says "Kode IMPA ini sudah dipakai produk aktif lain."

  Scenario: Linking an inactive vendor returns 422
    Given an existing item
    When the user links an inactive vendor to the item
    Then the response status is 422

  Scenario Outline: Whitespace-only names are rejected on create
    When the user creates an item named "<name>"
    Then the response status is 422

    Examples:
      | name |
      |      |
      | \t   |

  Scenario Outline: A search with LIKE wildcards matches literally
    Given an item named with "<wildcard>" and a decoy without it
    When the user lists items searching for the literal name
    Then the response status is 200
    And the list holds only the item with the wildcard

    Examples:
      | wildcard |
      | %        |
      | _        |

  Scenario: A search with a NUL byte returns 400
    When the user sends GET "/items/?q=bolt%00nut"
    Then the response status is 400

  Scenario: An invalid unitId filter returns 400
    When the user sends GET "/items/?unitId=pcs"
    Then the response status is 400

  Scenario Outline: A sub-collection of a missing item returns 404
    When the user sends GET "/items/999999999/<collection>"
    Then the response status is 404

    Examples:
      | collection    |
      | vendors       |
      | price-history |

  Scenario Outline: Whitespace-only names are rejected on update
    Given an existing item
    When the user renames the item to only <blank>
    Then the response status is 422
    When the user reads the item
    Then the item name matches the seeded value

    Examples:
      | blank    |
      | spaces   |
      | a tab    |
      | newlines |

  Scenario: Image PATCH rejects a key outside the entity prefix
    Given an existing item
    When the user attaches an image stored under another item
    Then the response status is 422

  Scenario: The Katalog search total equals the server match count
    Given 7 items share a new search token
    When the user searches the Katalog for the token with "limit=4"
    Then the response status is 200
    And the page holds 4 hits of 7
    When the user searches the Katalog for the token with "limit=4&offset=4"
    Then the response status is 200
    And the page holds 3 hits of 7
    And the pages together hold every token item
