Feature: RFQ upload
  A client's request for quotation arrives as a workbook. The API reads
  its product rows, skipping category rows, and the wizard matches them
  against the catalog.

  Background:
    Given an authenticated user with id 1

  Scenario: An uploaded RFQ matches its rows against the catalog
    Given a catalog item with a fresh IMPA code
    When the user uploads an RFQ listing that item and an unknown product under a category row
    Then the response status is 200
    And the upload returns the item and the unknown product
    When the user matches the uploaded rows against the catalog
    Then the response status is 200
    And the item matches by IMPA code and the unknown product matches nothing

  Scenario: An upload that is not a workbook is refused
    When the user uploads a text file named "permintaan.xlsx"
    Then the response status is 422
    And the problem detail mentions "Format berkas tidak didukung."

  Scenario: An RFQ with more product rows than one match takes is refused
    When the user uploads an RFQ with 501 product rows
    Then the response status is 422
    And the problem detail mentions "Berkas berisi 501 baris produk; paling banyak 500 per unggahan."
