Feature: Asset storage through the authenticated proxy
  Logos, item images, PO documents and invoice attachments stay on the
  internal object store. The API streams their bytes in and out, refuses a
  role outside a bucket's audience, never replaces a stored object, and
  serves every download as an attachment typed by its extension.

  Scenario: A superadmin stores a PO document and reads the same bytes back
    Given I am signed in as "superadmin"
    When I upload "scan.pdf" of 4096 bytes to "po-docs"
    Then the response status is 204
    When I download that object
    Then the response status is 200
    And the download carries the uploaded bytes
    And the download is an attachment of type "application/pdf"

  Scenario: An upload never replaces a stored object
    Given I am signed in as "operational"
    And I uploaded "order.pdf" of 64 bytes to "po-docs"
    When I upload different bytes to the same key
    Then the response status is 409
    And the response is problem+json
    When I download that object
    Then the download carries the uploaded bytes

  Scenario: The type the uploader claimed never decides how a download is served
    Given I am signed in as "finance"
    When I upload "logo.png" of 32 bytes to "client-logos" claiming type "text/html"
    Then the response status is 204
    When I download that object
    Then the download is an attachment of type "image/png"
    And the download forbids sniffing and framing

  Scenario Outline: A role outside a bucket's audience is refused both ways
    Given I am signed in as "<role>"
    When I upload "<file>" of 16 bytes to "<bucket>"
    Then the response status is 403
    And the response is problem+json
    And nothing is stored under that key
    When I download that object
    Then the response status is 403

    Examples:
      | role        | bucket              | file      |
      | finance     | po-docs             | scan.pdf  |
      | operational | invoice-attachments | proof.pdf |

  Scenario Outline: Each role reaches the buckets it shares
    Given I am signed in as "<role>"
    When I upload "<file>" of 16 bytes to "<bucket>"
    Then the response status is 204
    When I download that object
    Then the response status is 200
    And the download carries the uploaded bytes

    Examples:
      | role        | bucket              | file       |
      | finance     | invoice-attachments | proof.pdf  |
      | superadmin  | invoice-attachments | proof.xlsx |
      | operational | po-docs             | scan.jpg   |
      | operational | item-images         | item.webp  |
      | finance     | vendor-logos        | logo.gif   |

  Scenario: A request without a session is told to sign in
    Given I am not signed in
    When I upload "scan.pdf" of 16 bytes to "po-docs"
    Then the response status is 401
    And the problem detail is "Anda belum masuk. Silakan masuk terlebih dahulu."

  Scenario Outline: Unsafe keys and unknown buckets are refused before the store
    Given I am signed in as "superadmin"
    When I upload to bucket "<bucket>" at key "<key>"
    Then the response status is <status>
    And the response is problem+json

    Examples:
      | bucket       | key                  | status |
      | po-docs      | ../escape.pdf        | 400    |
      | po-docs      | /absolute.pdf        | 400    |
      | po-docs      | scan.exe             | 400    |
      | client-logos | logo.pdf             | 400    |
      | no-bucket    | scan.pdf             | 403    |

  Scenario: A file past the bucket cap is refused and leaves nothing behind
    Given I am signed in as "superadmin"
    When I upload "big.png" of 2097153 bytes to "client-logos"
    Then the response status is 413
    And the problem detail is "Ukuran berkas melebihi batas 2 MB. Pilih berkas yang lebih kecil."
    And nothing is stored under that key
    When I upload different bytes to the same key
    Then the response status is 204

  Scenario: A missing object is reported as not found
    Given I am signed in as "superadmin"
    When I download a key nobody uploaded from "po-docs"
    Then the response status is 404
    And the response is problem+json

  Scenario: A client logo goes through upload URL, upload, attach and download
    Given I am signed in as "superadmin"
    And a client I created
    When I ask for a logo upload URL for "logo.png"
    Then the response status is 200
    And the upload URL points at the proxy inside the client's folder
    When I upload 128 bytes to that upload URL
    Then the response status is 204
    When I attach the uploaded logo to the client
    Then the response status is 204
    When I ask for the logo download URL
    Then the response status is 200
    When I download from that URL
    Then the response status is 200
    And the download carries the uploaded bytes

  Scenario: A logo stored for another client cannot be attached
    Given I am signed in as "superadmin"
    And a client I created
    When I attach a logo key from another client's folder
    Then the response status is 422
    And the problem detail is "Berkas tidak dikenali. Unggah ulang berkasnya lalu simpan kembali."
    When I ask for the logo download URL
    Then the response status is 404
