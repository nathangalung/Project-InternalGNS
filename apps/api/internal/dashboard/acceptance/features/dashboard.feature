Feature: Dashboard financial figures
  Finance reads revenue, expenses and net profit on the DPP base: PPN is
  collected for the state, so it is never booked as income.

  Background:
    Given the commercial domain is empty

  Scenario: Net profit equals paid DPP minus cost
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is paid
    When finance reads the dashboard summary
    Then the response status is 200
    And revenue is 200000.00 and equals the paid DPP sum
    And expenses are 80000.00 and equal the paid cost sum
    And net profit is 120000.00
    And PPN is 22000.00 and equals the paid PPN sum

  Scenario: An unpaid invoice books nothing
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is sent
    When finance reads the dashboard summary
    Then the response status is 200
    And revenue is 0 and equals the paid DPP sum
    And net profit is 0

  Scenario: A cancelled invoice and its Pengganti count as one invoice
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is cancelled and replaced
    When finance reads the dashboard summary
    Then the response status is 200
    And the dashboard counts 1 invoice
    And the invoice tiles read "draft:1,sent:0,overdue:0,paid:0,cancelled:1"

  Scenario: Ditolak counts only rejected quotations
    Given a quotation in status "rejected"
    And a quotation in status "expired"
    When operational reads the dashboard summary
    Then the response status is 200
    And the quotation tiles read "draft:0,sent:0,revision:0,accepted:0,rejected:1,cancelled:0,expired:1"
    And the dashboard counts 1 rejected quotation

  Scenario: Operational sees operational tiles only
    Given an invoice for 2 units at 100000 costing 40000 each
    When operational reads the dashboard summary
    Then the response status is 200
    And the purchase order tiles read "PENDING:0,UPLOADED:0,ON_PROGRESS:0,DELIVERED:1,CANCELLED:0"
    And the invoice tiles read ""

  Scenario: A past-due sent invoice is Terlambat
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is sent
    And the invoice is past its due date
    When finance reads the dashboard summary
    Then the response status is 200
    And the invoice tiles read "draft:0,sent:0,overdue:1,paid:0,cancelled:0"

  Scenario Outline: The overview strips financial figures for operational only
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is paid
    When <role> reads the dashboard summary
    Then the response status is 200
    And the financial figures are <figures>

    Examples:
      | role        | figures  |
      | superadmin  | shown    |
      | finance     | shown    |
      | operational | stripped |

  Scenario Outline: Financial series are gated by role
    When <role> reads the "<metric>" series
    Then the response status is <status>

    Examples:
      | role        | metric    | status |
      | operational | quotation | 200    |
      | operational | revenue   | 403    |
      | operational | profit    | 403    |
      | operational | ppn       | 403    |
      | operational | invoice   | 403    |
      | finance     | revenue   | 200    |
      | finance     | profit    | 200    |
      | finance     | ppn       | 200    |
      | finance     | invoice   | 200    |
      | superadmin  | profit    | 200    |

  Scenario Outline: Only finance roles export the dashboard
    When <role> exports the dashboard for the current year
    Then the response status is <status>

    Examples:
      | role        | status |
      | operational | 403    |
      | finance     | 200    |
      | superadmin  | 200    |

  Scenario: The export for a year reconciles with its months and the tables
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is paid
    When finance exports the dashboard for the current year
    Then the response status is 200
    And the file is named for the current year
    And the monthly sheet lists the 12 months of the current year
    And each summary total equals the sum of its monthly column
    And the summary revenue equals the paid DPP sum for the current year

  Scenario: An empty year exports zeros for every month
    When finance exports the dashboard for year 2031
    Then the response status is 200
    And the monthly sheet lists the 12 months of 2031
    And every summary and monthly figure is 0

  Scenario: An empty domain reads as zeros
    When finance reads the dashboard summary
    Then the response status is 200
    And every summary figure is 0
    And the invoice tiles read "draft:0,sent:0,overdue:0,paid:0,cancelled:0"

  Scenario Outline: Series bucket by the WIB calendar
    Given a quotation created at "<instant>"
    When operational reads the "quotation" series by <interval> from "<from>" to "<to>"
    Then the response status is 200
    And the series reads "<series>"

    Examples:
      | instant              | interval | from       | to         | series        |
      | 2031-03-31T16:30:00Z | month    | 2031-03-01 | 2031-05-01 | 2031-03:1     |
      | 2031-03-31T17:30:00Z | month    | 2031-03-01 | 2031-05-01 | 2031-04:1     |
      | 2031-03-31T16:30:00Z | day      | 2031-03-31 | 2031-04-02 | 2031-03-31:1  |
      | 2031-03-31T17:30:00Z | day      | 2031-03-31 | 2031-04-02 | 2031-04-01:1  |

  Scenario: A legacy stored Terlambat with a future due date is Terlambat everywhere
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is stored as overdue and due in 3 days
    When finance reads the dashboard summary
    Then the response status is 200
    And the dashboard counts 1 overdue and 0 due soon invoices
    And the invoice tiles read "draft:0,sent:0,overdue:1,paid:0,cancelled:0"
    And the overdue and due soon counts match the tables

  Scenario: A sent invoice due in 3 days is due soon, not Terlambat
    Given an invoice for 2 units at 100000 costing 40000 each
    And the invoice is sent
    And the invoice is due in 3 days
    When finance reads the dashboard summary
    Then the response status is 200
    And the dashboard counts 0 overdue and 1 due soon invoices
    And the overdue and due soon counts match the tables
