Feature: Delivery note Address and Notes
  The delivery note's Address says where the goods go, so no row repeats
  it. Its Notes column carries one note per product row, saved when the
  note is downloaded, so a reprint prints the same notes. A row going
  somewhere else starts with where it goes.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: A saved note prints on every reprint
    Given an accepted quotation shipping to "Dermaga Koja Utara" with a second line going to "Gudang Cakung"
    And the PO has reached "ON_PROGRESS"
    When the user lists PO items
    Then product line 1 starts with no note
    And product line 2 starts with the note "Kirim ke: Gudang Cakung"
    When the user saves the note "Serahkan ke mualim" on product line 1
    Then the response status is 200
    When the user lists PO items
    Then product line 1 has the note "Serahkan ke mualim"
    When the user downloads the delivery note
    Then the delivery note prints the Address "Dermaga Koja Utara" once
    And the delivery note prints "Serahkan ke mualim"
    And the delivery note prints "Kirim ke:" once
    When the user downloads the delivery note
    Then the delivery note prints "Serahkan ke mualim"

  Scenario: Notes wait until work starts
    Given an accepted quotation
    When the user saves the note "Serahkan ke mualim" on product line 1
    Then the PO is refused as locked with "Catatan surat jalan hanya bisa diubah saat PO Dalam Progres atau Dikirim."

  Scenario: A stale note save is refused
    Given an accepted quotation
    And the PO has reached "ON_PROGRESS"
    When the user saves a note on product line 1 with a stale If-Match
    Then the response status is 409

  Scenario: Operational input cannot save notes
    Given an accepted quotation
    And the PO has reached "ON_PROGRESS"
    And a signed-in "operational_input" user
    When that user saves a note on product line 1
    Then the response status is 403
