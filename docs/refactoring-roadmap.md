# Refactoring Roadmap

Tracks the work coming out of the 2026-08 architecture audit
(`architecture-audit-2026-08.md`, 7 domain scouts + synthesis + adversarial
review). This file is the progress ledger and the decision queue.

## Done (behavior-preserving, verified, committed)

Every item below shipped with build + vet + typecheck + lint + the full test
suite green, and passed an adversarial per-commit review.

| Commit | Finding(s) | What changed |
|--------|-----------|--------------|
| `62667ae` | #18, #21, #13, logging, #20 | RequiredKeys gap + self-maintaining drift test; timeout → 503+Retry-After; prod credential gate; request_id slog handler + LOG_LEVEL; shutdown budget grace>drain>handler |
| `e922532` | #14, skipToken, dashboard inval, `<Link>`, openapi, api.ts | logout clears query cache; skipToken across id-keyed hooks; dashboard invalidation on mutations; Sidebar real links; dead codegen removed; 7 missing DTO fields |
| `f724ad6` | items 622-line handler | extract pure ranking logic to `merge.go` |
| `21ded9f` | #24 | 5-slice presign triplet → `shared/assetproxy` (−536 lines, all divergences preserved, PO presign gap closed) |
| `e9d4a8f` | review fixes | dedupe request_id; allow empty MinIO (storage-disabled mode); 503→Warn in access log |
| `9a59649` | #133 | duplicated `parseDateParam` → `shared/httpx` |
| `1b1ef45` | #122, #144 | memoize client sort; drop dead filter branch |

## Remaining — needs owner sign-off before starting

These change a user-visible or filed value. Ordered by the audit's severity
(tax/legal → data loss → security). **Do not start any of these without the
answer to its question.** Numbers are audit finding IDs.

### Phase 1 progress (owner answered Q2/Q3/DJP/Q7)
- **DONE #3 timezone** — pool session zone pinned to WIB, assertion, tz package wired (`965ad61`).
- **DONE per-line PPN rounding** — ppn from the rounded DPP base (`0250a0a`, forward-only).
- **DONE #2 invoice discount** — gross line + stored discount, `TotalProduk − Diskon = DPP` by construction (`aed27b0`).
- **Historical backfill: intentionally NOT done.** Restating per-line PPN / header DPP on already-filed invoices would make the DB disagree with what was filed with DJP — worse than leaving it. Forward fixes are the correct scope; filed history stays as-filed.
- **Remaining:** #6 PO shipping_days (data loss), #7 overdue boundary + consolidation. Low-priority: rewrite the manual `db/checks/01_verify_advanced.sql` B.3 (asserts the pre-00039 header formula, misleads).

### Phase 1 — tax & legal correctness (highest stakes)
- **#1 (CRITICAL)** exports silently truncate at 200 rows, incl. the DJP
  coretax bulk workbook. Fix bundles with the coretax N+1 and a per-route
  timeout (Phase 2). Filings change size/content → sign-off. *Partial mitigation
  shipped: all four export paths now emit a truncation Warn log
  (`httpx.WarnIfTruncated`), so a period filed incomplete is no longer silent —
  the actual unbounded fix still needs sign-off.*
- **#2 (CRITICAL)** invoice PDF totals block prints a false arithmetic
  identity (post-00021 discount subtracted twice; shipping line excluded).
  Blocked on **Q2** (should the invoice show a discount line at all?).
- **#3 (CRITICAL)** session timezone never set: invoice dates and
  document-number periods shift off WIB. Restates issued document numbers →
  sign-off.
- **#7** "overdue" off-by-one + three divergent definitions.
- **#6** PO `shipping_days` accepted but silently discarded since 00024.
- Per-line PPN rounding + 00039 header-dpp backfill — **restates values filed
  with DJP**; requires the per-year delta query and DJP sign-off (**Q3**).

### Phase 2 — export bundle (ship as one)
- #1 unbounded export + `list_items_bulk` (kills coretax N+1) + per-route
  timeout + streaming XLSX. Splitting #1 out first only converts silent
  truncation into a 30s timeout.

### Phase 3 progress
- **DONE credential hardening** (`8a55eb0`): login enumeration/timing/500→401,
  LOWER(email) unique index + normalize, last-superadmin guard, and #12 (revoke
  refresh tokens on password/role/deactivation change).
- **Dashboard RBAC**: verified already correctly gated in-handler (overview
  strips financial, timeseries gates per-metric, export finance-only, all with
  negative tests). No hole; CLAUDE.md convention 6 corrected to the real model.
- **Deferred as low-value given Q7 (≤5 trusted internal users):** per-user rate
  limits on PDF/XLSX/upload, unconditional CORS/env checks, trustedProxyIP CIDR
  allowlist, storage object-key signing (cross-user overwrite is within the
  "all authed users manage master data" model, not a bug). #11 JWT_EXPIRY→15m
  still worth doing (small, transparent via auto-refresh) but is a session
  behavior change.

### Phase 3 — security (strictly ordered, #12 before #11)
- **#12** password-change / deactivation / role-change do not revoke refresh
  tokens (720h window). Needs the transaction seam (#17).
- **#11** access token never re-validated; `JWT_EXPIRY` 24h. Shorten to 15m +
  per-request user/role check → session behavior change.
- Login user-enumeration + timing oracle; `users_email_lower_idx`; split the
  `/dashboard` router so financial routes have a mount gate; last-superadmin
  guard; storage-proxy object-key signing; per-user rate limits on PDF/XLSX.

## Phase 6 (perf/ops) progress
- **DONE** reachable vendor-SKU trigram index + refresh-token purge ticker
  (`1ffbf61`); shutdown budget, request-id logs, LOG_LEVEL, export-truncation
  warn (earlier commits).
- **#15 re-diagnosed with EXPLAIN (audit was wrong):** only `search_vendor_offers`
  was fixable. `fn_search_vendors`/`fn_search_clients` cannot reach their name
  trigram indexes at all (join filter / cross-table OR — never a BitmapOr
  candidate), and `items.impa_code` has no trigram index. Net: three name
  trigram indexes (`idx_vendors_name_trgm`, `idx_company_client_name_trgm`,
  `idx_company_contacts_name_trgm`) are dead weight — **owner call:** drop them
  (correct at current ≤few-thousand-row scale) or restructure the search
  functions into per-table UNION branches (only worth it if the catalog grows
  large). `idx_items_name_trgm` is live — keep it.
- **Deferred, low value at scale:** #16 dashboard cost CTEs, count-query LATERAL
  removal, container resource limits + PDF_RENDER_CONCURRENCY, two-phase boot.

## Remaining — behavior-preserving but large / needs QA

Safe in principle, deferred because they touch central wiring or need manual
browser QA, not because they change behavior.

- **#17a** widen the DI seam (`Deps.Pool` has no `Begin`) so a slice *can* open
  a transaction — additive plumbing, nothing calls it yet, behavior-preserving.
  **The structural spine — every backend error-contract fix and #12 depend on
  it.** (S/M, safe)
- **#17b** rewrite the 500-row item import (`MatchRows`) as one transaction.
  Behavior-change: today a mid-loop failure persists the already-created items
  and a retry duplicates them; after, nothing persists. Better, but a changed
  failure-path workflow → **sign-off**. Depends on #17a.
- **#131** `NewHandler(repo, storage)` so a missing dep is a compile error;
  construct shared repos once in `app.NewRouter` instead of each slice building
  its siblings. (M)
- **#26** move the app shell into `_authed.tsx`; delete `lib/page.ts` +
  `lib/page-nav.ts` (a shadow router) and the prop-drilling through 40 files.
  One mechanical pass; needs active-state / drawer / mobile QA. (L)
- **#25** extract `shared/listq` (7 copies of the list-query builder). The
  extraction is safe; unifying default sort direction + adding tiebreakers is a
  behavior change → sign-off. (L)
- **#19** finish `db/functions/` (2 of ~8 present, no drift check) + per-
  function Go tests. (M)
- Error-classification: assign SQLSTATEs, delete the `strings.Contains`
  classifiers (some 500s become 422s → contract change). Depends on #17. (M)
- Route loaders + `key={id}` hydrate-once (#8); `useListScreen` + `TableStates`
  (six duplicated list screens); `deriveInvoiceStatus` single source (#127,
  tie in with #7). (M each)

## Open questions for the owner

Answers unblock Phase 1/3. Full context in the audit §7.

- **Q1** Keep hand-maintained `types/api.ts` (verdict: yes; codegen scaffolding
  already deleted) — or generate TS from the Go json tags later?
- **Q2** Should the invoice show a discount line at all? Blocks #2.
- **Q3** Is dashboard revenue/profit meant to be VAT-inclusive? Is `cost_price`
  ex-VAT? Determines whether the daily profit figure is overstated ~11%.
- **Q4** Per-function SQL-vs-Go — ask only after #17. Constraint: the
  lock-first `FOR UPDATE` status machines must not become Go pre-checks.
- **Q5** Does the "data is UPPERCASE" convention hold? Picks the cheaper half
  of the unreachable-trigram-index fix (#15).
- **Q6** Accept forward-only rollback + expand-contract as policy? (#23)
- **Q7** Single node forever, or eventual replicas? Determines whether the
  in-process rate-limit counter must move to a shared store.
- **Q8** Is restating `invoice_date` after filing a real finance need? (#8/audit)
- **Q9** PDF as a queue — verdict: no; fix the failure mode, not the
  architecture, until the semaphore queue-wait exceeds ~1s.
