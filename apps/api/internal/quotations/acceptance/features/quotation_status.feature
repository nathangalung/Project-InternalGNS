Feature: Quotation status model
  Ditolak means the client declined and Dibatalkan means we withdrew;
  both need a reason. Buat Revisi clones a sent quotation into the next
  draft version. A daily job expires sent quotations past their validity.
  The API returns the allowed moves so the screen never hardcodes them.

  Background:
    Given an authenticated user with id 1
    And the quotation domain is empty

  Scenario Outline: Refused transitions
    Given an existing draft quotation
    And the user transitions the quotation through "<setup>" giving a reason
    When the user tries to transition the quotation to "<target>" giving a reason
    Then the response status is 422
    And the quotation status is still "<current>"

    Examples:
      | setup                  | current   | target    |
      | none                   | draft     | accepted  |
      | none                   | draft     | rejected  |
      | none                   | draft     | expired   |
      | none                   | draft     | revision  |
      | sent                   | sent      | expired   |
      | sent                   | sent      | draft     |
      | sent,accepted          | accepted  | cancelled |
      | sent,accepted          | accepted  | sent      |
      | sent,rejected          | rejected  | cancelled |
      | cancelled              | cancelled | sent      |
      | sent,revise            | revision  | sent      |
      | sent,revise            | revision  | accepted  |

  Scenario: Revision is not a plain status change
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    When the user tries to transition the quotation to "revision" giving a reason
    Then the response status is 422
    And the problem detail mentions "Buat Revisi"

  Scenario Outline: A reason is required to reject or cancel
    Given an existing draft quotation
    And the user transitions the quotation through "<setup>" giving a reason
    When the user tries to transition the quotation to "<target>" without a reason
    Then the response status is 422
    And the problem names the field "note"
    And the quotation status is still "<current>"

    Examples:
      | setup | current | target    |
      | sent  | sent    | rejected  |
      | sent  | sent    | cancelled |
      | none  | draft   | cancelled |

  Scenario: The reason is kept in the history
    Given an existing draft quotation
    When the user transitions the quotation through "cancelled" giving a reason
    And the user reads the quotation
    Then the latest history entry moves to "cancelled" with the reason

  Scenario Outline: The detail lists the allowed moves
    Given an existing draft quotation
    And the user transitions the quotation through "<setup>" giving a reason
    When the user reads the quotation
    Then the allowed transitions are "<allowed>"
    And the quotation can be revised: <revise>

    Examples:
      | setup         | allowed                    | revise |
      | none          | sent,cancelled             | no     |
      | sent          | accepted,rejected,cancelled | yes    |
      | sent,revise   | rejected,cancelled         | no     |
      | sent,accepted | none                       | no     |
      | cancelled     | none                       | no     |

  Scenario: Buat Revisi clones a sent quotation into the next draft
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    When the user revises the quotation
    Then the response status is 201
    And the new revision is a draft at version 2 numbered "Rev.1"
    And the original quotation status is "revision"
    And the revision chain holds 2 quotations

  Scenario: The new revision edits and sends like any draft
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    When the user revises the quotation
    And the user edits the new revision
    Then the response status is 200
    When the user sends the new revision
    Then the response status is 204

  Scenario: Only a sent quotation can be revised
    Given an existing draft quotation
    When the user revises the quotation
    Then the response status is 422
    And the quotation status is still "draft"

  Scenario: Revising an unknown quotation
    When the user revises quotation 9999999
    Then the response status is 404

  Scenario: Stats list every status in order
    Given an existing draft quotation
    And the user transitions the quotation through "cancelled" giving a reason
    When the user reads the quotation stats
    Then the stats list "draft,sent,revision,accepted,rejected,cancelled,expired"
    And the stats labels are "Draf,Dikirim,Revisi,Disetujui,Ditolak,Dibatalkan,Kedaluwarsa"
    And the stats count 1 "cancelled" and 0 "rejected"

  # The job reads its clock on the WIB calendar: 8 March 17:01Z is
  # already 9 March in Jakarta, the first day past a 7-day validity.
  Scenario Outline: The daily job expires sent quotations past validity
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    And the quotation was sent at "2026-03-01T10:00:00+07:00" with a validity of 7 days
    When the expiry job runs at "<now>"
    And the user reads the quotation
    Then the quotation status is "<status>"

    Examples:
      | now                       | status  |
      | 2026-03-05T12:00:00+07:00 | sent    |
      | 2026-03-08T16:59:00Z      | sent    |
      | 2026-03-08T17:01:00Z      | expired |
      | 2026-04-20T12:00:00+07:00 | expired |

  Scenario: The send date is read in WIB too
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    And the quotation was sent at "2026-02-28T17:30:00Z" with a validity of 7 days
    When the expiry job runs at "2026-03-08T10:00:00Z"
    And the user reads the quotation
    Then the quotation status is "sent"

  Scenario: An expired quotation records a system history note
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    And the quotation was sent at "2026-03-01T10:00:00+07:00" with a validity of 7 days
    When the expiry job runs at "2026-03-10T08:00:00+07:00"
    And the user reads the quotation
    Then the latest history entry is a system note mentioning "masa berlaku 7 hari sejak 01-03-2026"

  Scenario Outline: Only superadmin and operational change quotation status
    Given an existing draft quotation
    And the user transitions the quotation through "sent" giving a reason
    When a "<role>" user <action> the quotation through the API
    Then the response status is <code>

    Examples:
      | role        | action  | code |
      | finance     | cancels | 403  |
      | finance     | revises | 403  |
      | operational | cancels | 204  |
      | operational | revises | 201  |
      | superadmin  | rejects | 204  |
