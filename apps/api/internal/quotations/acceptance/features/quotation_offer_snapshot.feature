Feature: A filed quotation keeps its offer
  A quotation that reached the client shows and prints the product it
  offered as the product was named when it left draft. A draft follows the
  catalog, so a corrected product name reaches every quotation still being
  written and none already sent.

  Background:
    Given an authenticated user with id 1
    And the quotation domain is empty

  Scenario: Renaming a product leaves a sent quotation as sent
    Given a catalog product offered on a sent quotation and on a draft
    When the product is renamed and given a new IMPA code
    Then the sent quotation still offers the old name and code
    And the draft offers the new name and code
    And the sent quotation PDF prints the old name and code

  Scenario: Accepting a filed quotation orders what the client accepted
    Given a catalog product offered on a sent quotation and on a draft
    When the product is renamed and given a new IMPA code
    And the user accepts the sent quotation
    Then its purchase order line carries the old name and code
