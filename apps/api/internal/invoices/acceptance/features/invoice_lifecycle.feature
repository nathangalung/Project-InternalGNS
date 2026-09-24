Feature: Invoice lifecycle
  Finance team must move an invoice through draft, sent and paid,
  and the invoice must materialize as a snapshot of its source PO.

  Background:
    Given an authenticated user with id 1
    And the commercial domain is empty

  Scenario: Delivered PO auto-creates draft invoice
    Given a delivered purchase order
    When the user reads the invoice by quotation
    Then the response status is 200
    And the invoice status is "draft"
    And the invoice number is set
    And the invoice has positive total

  Scenario: Invoice detail carries the client and PO header
    Given a delivered purchase order
    When the user reads the invoice by quotation
    Then the response status is 200
    And the invoice detail carries the client and purchase order header
    And the invoice detail offers the transitions the database allows

  Scenario: Read invoice snapshot items
    Given a delivered purchase order
    When the user lists invoice items
    Then the response status is 200
    And the invoice items contain at least 1 product line

  Scenario Outline: Valid invoice status transitions
    Given a delivered purchase order
    When the user transitions the invoice through "<path>"
    Then every invoice transition succeeds

    Examples:
      | path        |
      | sent        |
      | sent,paid   |

  Scenario: Saving an unchanged past-due draft is accepted
    Given a delivered purchase order
    When the user updates the invoice dates to invoice "2019-12-02" due "2020-01-01"
    Then the response status is 200
    When the user tries to transition the invoice to "draft"
    Then the response status is 204

  Scenario: A past-due draft saved as Terlambat stays a draft
    Given a delivered purchase order
    When the user updates the invoice dates to invoice "2019-12-02" due "2020-01-01"
    Then the response status is 200
    When the user tries to transition the invoice to "overdue"
    Then the response status is 204
    When the user reads the invoice by quotation
    Then the invoice status is "draft"

  Scenario: Terlambat cannot be chosen by hand before the due date
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user tries to transition the invoice to "overdue"
    Then the response status is 422

  Scenario: Reject unknown status value
    Given a delivered purchase order
    When the user tries to transition the invoice to "garbage"
    Then the response status is 422

  Scenario: Update invoice dates
    Given a delivered purchase order
    When the user updates the invoice dates to invoice "2031-01-10" due "2031-02-09"
    Then the response status is 200
    And the invoice dates read invoice "2031-01-10" due "2031-02-09"

  Scenario: Paid invoice keeps its dates
    Given a delivered purchase order
    When the user transitions the invoice through "sent,paid"
    And the user updates invoice due date to "2031-12-31"
    Then the response status is 422
    And the problem detail is "Invoice yang sudah dibayar atau dibatalkan tidak dapat diubah tanggalnya."

  Scenario: Cancelled invoice keeps its dates
    Given a delivered purchase order
    When the user transitions the invoice through "cancelled"
    And the user updates invoice due date to "2031-12-31"
    Then the response status is 422
    And the problem detail is "Invoice yang sudah dibayar atau dibatalkan tidak dapat diubah tanggalnya."

  Scenario Outline: A due date before the invoice date is refused
    Given a delivered purchase order
    When the user updates the invoice dates to invoice "2031-01-10" due "2031-02-09"
    And the user updates the invoice dates to invoice "<invoice>" due "<due>"
    Then the response status is <status>
    And the invoice dates read invoice "<keptInvoice>" due "<keptDue>"

    Examples:
      | invoice    | due        | status | keptInvoice | keptDue    |
      | 2031-01-10 | 2031-01-09 | 422    | 2031-01-10  | 2031-02-09 |
      |            | 2031-01-09 | 422    | 2031-01-10  | 2031-02-09 |
      | 2031-02-10 |            | 422    | 2031-01-10  | 2031-02-09 |
      | 2031-01-10 | 2031-01-10 | 200    | 2031-01-10  | 2031-01-10 |
      |            | 2031-01-10 | 200    | 2031-01-10  | 2031-01-10 |

  Scenario: The date order refusal names the due date
    Given a delivered purchase order
    When the user updates the invoice dates to invoice "2031-01-10" due "2031-01-09"
    Then the response status is 422
    And the problem detail is "Tanggal jatuh tempo tidak boleh sebelum tanggal invoice."

  Scenario: A paid invoice reports its lock before the date order
    Given a delivered purchase order
    When the user transitions the invoice through "sent,paid"
    And the user updates the invoice dates to invoice "2031-01-10" due "2031-01-09"
    Then the response status is 422
    And the problem detail is "Invoice yang sudah dibayar atau dibatalkan tidak dapat diubah tanggalnya."

  Scenario: Summary endpoint returns aggregates
    Given a delivered purchase order
    When the user reads the invoice summary
    Then the response status is 200
    And the invoice summary total is at least 1
    And the invoice summary buckets sum to total

  Scenario: List filters return invoice rows
    Given a delivered purchase order
    When the user lists invoices filtered by status "draft"
    Then the response status is 200
    And the invoice list contains at least 1 row

  Scenario: A cancelled invoice is replaced by a Pengganti invoice
    Given a delivered purchase order
    When the user transitions the invoice through "sent,cancelled"
    And the user replaces the invoice
    Then the response status is 201
    When the user reads the invoice by quotation
    Then the invoice status is "draft"
    And the invoice is the Pengganti of the cancelled invoice

  Scenario: Only a cancelled invoice can be replaced
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user replaces the invoice
    Then the response status is 422

  Scenario: A cancelled invoice is replaced only once
    Given a delivered purchase order
    When the user transitions the invoice through "cancelled"
    And the user replaces the invoice
    And the user replaces the invoice
    Then the response status is 409

  Scenario: A catalog rename leaves an issued invoice unchanged
    Given a delivered purchase order offering a catalog item
    When the user lists invoice items
    Then the invoice items name the offered item as issued
    When the user transitions the invoice through "sent"
    And the offered catalog item is renamed
    And the user lists invoice items
    Then the response status is 200
    And the invoice items name the offered item as issued
    And the Coretax export names the offered item as issued

  Scenario Outline: The detail offers exactly the moves the database allows
    Given a delivered purchase order
    When the user transitions the invoice through "<path>"
    Then the invoice detail offers "<offers>"

    Examples:
      | path           | offers                                   |
      | draft          | sent:Dikirim,cancelled:Dibatalkan*       |
      | sent           | paid:Dibayar,cancelled:Dibatalkan*       |
      | sent,paid      |                                          |
      | cancelled      |                                          |

  Scenario Outline: Moves the database refuses
    Given a delivered purchase order
    When the user transitions the invoice through "<path>"
    And the user tries to transition the invoice to "<target>"
    Then the response status is 422
    And the problem detail is "Perubahan status invoice ini tidak diizinkan."

    Examples:
      | path           | target    |
      | draft          | paid      |
      | sent           | draft     |
      | sent,paid      | cancelled |
      | sent,paid      | sent      |
      | cancelled      | sent      |
      | cancelled      | draft     |

  Scenario: Marking an invoice paid records the payment and its proof
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user marks the invoice paid with a payment proof
    Then the response status is 204
    And the invoice records its payment date with a proof
    And the invoice history is "draft>sent,sent>paid"

  Scenario: A payment proof that never arrived is refused
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user marks the invoice paid with a payment proof that never arrived
    Then the response status is 422
    And the problem detail is "Berkas bukti pembayaran belum terunggah. Unggah ulang berkasnya lalu simpan kembali."
    And the invoice history is "draft>sent"

  Scenario: The payment proof is optional
    Given a delivered purchase order
    When the user transitions the invoice through "sent,paid"
    Then the invoice records its payment date without a proof

  Scenario: A cancel without a reason is refused
    Given a delivered purchase order
    When the user cancels the invoice without a reason
    Then the response status is 422
    And the problem detail is "Alasan pembatalan invoice wajib diisi."
    And the invoice history is ""

  Scenario: A cancel keeps its reason and offers the replacement
    Given a delivered purchase order
    When the user transitions the invoice through "sent"
    And the user cancels the invoice with reason "Salah alamat penagihan"
    Then the response status is 204
    And the invoice history is "draft>sent,sent>cancelled"
    And the last history entry carries the reason "Salah alamat penagihan"
    And the invoice offers a replacement

  Scenario: A replaced invoice offers no second replacement
    Given a delivered purchase order
    When the user transitions the invoice through "cancelled"
    And the user replaces the invoice
    Then the invoice withholds a replacement

  Scenario: Finance marks an invoice paid through the real router
    Given a delivered purchase order
    When the user acts as finance
    And the user transitions the invoice through "sent,paid"
    Then every invoice transition succeeds
    And the invoice records its payment date without a proof

  Scenario: Operational cannot change an invoice status
    Given a delivered purchase order
    When the user acts as operational
    And the user tries to transition the invoice to "sent"
    Then the response status is 403
