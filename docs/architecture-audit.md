# InternalGNS — Architecture & Performance Audit

Read-only audit by a multi-agent sweep (6 subsystem scouts → synthesis → adversarial
critic). Every claim below was checked against the actual files; the critic overturned
several scout consequences, and those corrections are folded in here (see
§"Corrected / overturned claims"). Nothing in the codebase was modified.

Scope audited: backend Go architecture, database + SQL, API surface + RBAC, frontend
architecture, frontend performance, infra + production readiness.

---

## 1. Verdict

The bones are good. This is a clean feature-sliced Chi service with a real repo/driver
seam, business invariants pushed into `FOR UPDATE` plpgsql functions, money kept as
`NUMERIC` end-to-end, proper optimistic locking, hashed rotating refresh tokens, and a
route-code-split SPA with correct cache/blob lifecycle handling. The layout does **not**
need restructuring — resist the urge to enterprise-ify a ~dozen-user internal app.

The problems are concentrated in **three seams that don't hold**, and they are serious:

1. **Authorization is not a boundary.** `requireRole` guards 2 of 10 mounted route
   subtrees. Finance can create/mutate quotations and purchase orders over the API. The
   storage proxy authorizes nothing at all.
2. **Fail-open configuration.** A single missing env line boots the API with a
   zero-length JWT signing key *and* the repo-published superadmin password. The login
   rate limiter is bypassable with a spoofed header, so that password is brute-forceable
   forever, not just on first boot.
3. **The invoice tax total is double-rounded**, so the number printed for the customer
   and the number filed with Coretax/DJP permanently disagree.

Everything else is maintainability, performance, and production-hardening work that can
be sequenced calmly behind those three.

---

## 2. What is already done well (keep it)

- **Repo/driver seam.** Every repo takes `db.Executor` (`internal/shared/db/exec.go:11`);
  integration tests wrap each case in a rolled-back tx (`testutil/db.go:79`).
- **Invariants in SQL, not Go.** Numbering, totals, status machines, and `row_version`
  guards live in plpgsql that takes its own `SELECT ... FOR UPDATE`; repos stay thin.
  Optimistic locking maps SQLSTATE P0010/P0011 → typed `ErrVersionMismatch`/`ErrNotFound`
  (`quotations/repo.go:236`), no string sniffing.
- **Money is `NUMERIC` everywhere**, cast `::text` at the query boundary so Go never
  binds a float64 — the single most common way an invoicing system loses cents, avoided
  deliberately.
- **Refresh tokens**: SHA-256 of 32 CSPRNG bytes, stored `BYTEA UNIQUE`, atomic
  `refresh_redeem` using `clock_timestamp()` (a token can't be resurrected mid-tx),
  rotation with reuse detection.
- **Boot-time validation.** `queries.Load()` checks a `RequiredKeys` manifest and rejects
  duplicate block names — startup fails loudly, not at first request.
- **Frontend discipline.** `autoCodeSplitting`, exceljs correctly behind
  `await import()` (verified: standalone 270KB gzip chunk, no modulepreload), devtools
  `PROD`-gated, `keepPreviousData` on every list, correct object-URL revoke lifecycle,
  `useSyncExternalStore` for cross-tab auth, one query-key factory, `tsc --noEmit` clean
  under `strict`.
- **Container hardening.** Non-root uid 10001, distroless consciously rejected for the
  xelatex runtime (documented), `ReadHeaderTimeout` set (Slowloris), `internal: true`
  network keeps Postgres off the routable net, Trivy + govulncheck + SBOM in CI.

No list needs virtualization (page sizes capped 5–15, server-side `limit`/`offset`) —
adding one would be pure overhead.

---

## 3. Clean architecture — what the system IS today

**Backend (`apps/api`)**

```
cmd/api/main.go     config → app.NewServer → ListenAndServe   (--bootstrap flag exists)
internal/app/       composition root: NewRouter builds the ONE middleware chain
                    (RequestID, RealIP, accessLog, Recoverer, Timeout 30s,
                     securityHeaders, bodyLimit 2MB, CORS)
internal/<feature>/ routes.go / handler.go / repo.go / dto.go — one slice per resource
db/queries/*.sql    hand-written named blocks, parsed + validated at boot
db/migrations/       Goose, append-only, 36 files
internal/shared/     db (Executor seam, pool, WithTx), httperr (RFC7807), httpx,
                     paginate (MaxLimit 200), deps (DI), money, tz
```

Flow: HTTP → chi chain → `feature.Routes(d)` → thin handler → repo (`store.Get` + pgx) →
Postgres. DI is one `deps.Deps` struct carrying `Pool db.Executor`, `Queries`, `Storage`.

**Frontend (`apps/web`)**

```
routes/            TanStack Router, file-based, autoCodeSplitting: true
features/<name>/   api.ts + hooks.ts (TanStack Query) + components
components/shared/  Sidebar, Pagination, tables
lib/               api-client (JWT + in-flight refresh dedupe), query-keys, rbac,
                   format, status, page/page-nav (legacy nav layer shadowing the router)
types/api.ts       the de-facto contract, hand-maintained, 576 lines
```

**Boundaries that hold:** `db.Executor`; `queries.Store` (validated at boot); the single
middleware chain; the feature-slice import rule in the SPA (one violation).

**Boundaries that do NOT hold:**
- **Authorization** — an optional `.With(requireRole())` decoration on 2/10 mounts; no
  default-deny.
- **Transactions** — `deps.Pool` is typed `db.Executor` (no `Begin`), so `db.WithTx` is
  unreachable; every multi-statement sequence runs on the raw pool.
- **Slice coupling** — `invoices → purchaseorders → quotations → clients → units` via
  concrete `*clients.Repo` pointers, not ports.
- **The declared API contract is fiction** — `openapi.yaml` documents 2 of 93 routes;
  `openapi.gen.ts` is imported by zero files.
- **Storage bytes bypass the resource layer** — presign authorizes a record; the byte
  proxy takes free-form `bucket`+`key` and authorizes nothing.

---

## 4. Critical problems (ranked, corrected)

Severity/effort in brackets. "BC" = changes observable product behavior (needs your
confirmation — see §8).

### Tier 0 — security, fix this week

| # | Problem | Sev | Eff | BC |
|---|---------|-----|-----|----|
| 1 | **Empty-but-set `JWT_SECRET` boots with a zero-length HMAC key** — every token forgeable. `env,required` passes on an empty string. | crit | S | Y |
| 2 | **Published superadmin password + fail-open default.** A missing env line falls back to `AdminGNS123!` (in the repo, 3 files). `cfg.Env` is never used to reject it. | crit | S | Y |
| 3 | **Rate-limit bypass (scout-missed, critic-found).** `middleware.RealIP` trusts `True-Client-IP`/`X-Real-IP`/`XFF` — all attacker-controlled; Traefik doesn't strip them. `httprate` keys off `r.RemoteAddr`, so `True-Client-IP: 10.0.0.<n>` with rotating n gives **unbounded** login attempts. Turns #2 from "first boot only" into "brute-forceable forever," and forges the access log `remote` field. | crit | S | Y |
| 4 | **`requireRole` on 2 of 10 mounts** — finance JWT authorizes POST/PUT/PATCH on `/quotations` and `/purchase-orders`. SPA hides the nav; the control is client-side only. | crit | S | Y |
| 5 | **`/storage/object` authorizes nothing.** Any role can write arbitrary keys into any bucket with an attacker-chosen `Content-Type`, and overwrite existing PO-doc keys (keys leak via `dto.go` `objectKey`). No CSP, no `X-Frame-Options` (only `nosniff`). The 2MB body cap is **waived** for `/storage/`, so it's also an unbounded disk-fill DoS on the volume Postgres shares. *(Correction: reading invoice attachments is NOT a live escalation — keys are timestamped/non-enumerable and `/invoices` is gated. The write primitive is the real bug.)* | crit | M | Y |

### Tier 1 — correctness & data integrity

| # | Problem | Sev | Eff | BC |
|---|---------|-----|-----|----|
| 6 | **Invoice PPN/DPP double-rounded** — `ROUND(subtotal*11/12,2)` per line vs `GENERATED` header columns from `dpp`. Coretax filing ≠ printed invoice, permanently. **The fix must convert `invoices.total` too** (it's a third generated column from `dpp`) or the inconsistency just moves to header-vs-header and desyncs the dashboard revenue tile (`SUM(total)`). Note migrations 00016→00017 already reverted a change here. | crit | M | Y |
| 7 | **Refresh misclassifies benign retry/duplicate-tab as reuse** and revokes every session for the user. `refresh_redeem` row-locks; the concurrent loser gets `ErrNoRows` → `revokeAllForUser`. Rotation (redeem + insert) is also non-atomic. sessionStorage tokens are copied on "Duplicate tab." | high | M | Y |
| 8 | **Two date/tz defects.** `invoices.summary` compares a DATE `due_date` to `NOW()` (timestamp) while the dashboard uses `CURRENT_DATE` — an invoice due *today* counts as overdue in one place, not the other (**confirmed live**). Second: `clients.summary` hardcodes `AT TIME ZONE 'Asia/Jakarta'` against an unpinned session TZ. *(Correction: the client-count miscount is probably NOT live — compose sets `TZ`/`PGTZ: Asia/Jakarta`; verify `SHOW timezone` before "fixing," because pinning TZ at the pool changes `CURRENT_DATE` app-wide.)* | med | S | Y |
| 9 | **Access tokens never re-checked vs DB** — deactivation/role-change take up to 24h (JWT expiry). *Fix via shorter expiry once #7 is safe, not a `token_version` cache.* | high | M | Y |
| 10 | **No transaction ever opens** (`db.WithTx` unreachable). TOCTOU in the unpriced-products status check; stale ETag in the update read-then-write path. *Fix by moving checks inside the existing `FOR UPDATE` functions, not by wrapping Go transactions.* | high | M | Y |

### Tier 2 — resilience, performance, scalability

| # | Problem | Sev | Eff | BC |
|---|---------|-----|-----|----|
| 11 | `httperr.FromDBErr` returns **raw Postgres text** in `detail` (e.g. `duplicate key ... "clients_npwp_key"`), rendered verbatim in the toast. Second channel (critic): `httperr.BadRequest(err.Error())` at `invoices/handler.go:264` and `dashboard/handler.go:53` leaks `strconv` errors too — grep all 4 sites. | high | M | Y |
| 12 | **Logout never clears the React Query cache** — next login authorizes/renders from the previous user's cached data. | high | S | Y |
| 13 | **Query failures have no render path** — `throwOnError` set nowhere, so a 500 shows "no data" and a network error shows "not found." | high | M | Y |
| 14 | **Unbounded xelatex fan-out.** Dead `Renderer.timeout`, 4 inconsistent timeout budgets, no concurrency semaphore, no container resource limits — a burst of PDF exports can exhaust the box. | high | M | Y |
| 15 | **Migrations run in-process on every boot, no advisory lock**; prod compose ignores the `--bootstrap` flag built for exactly this. Ship goose's session locker FIRST (zero topology change), then the one-shot container separately. | high | S | Y |
| 16 | **`/healthz` never touches the DB** and the api service has no compose healthcheck — Traefik keeps routing to an API whose Postgres is dead. Add `/readyz` (pool.Ping). | high | S | Y |
| 17 | **MinIO S3 API published to the public internet** via Traefik for no functional reason; both runbooks assert the opposite. Delete the labels. | high | S | N |
| 18 | **Missing indexes** for the actual queries: `idx_invoices_date`, `idx_quotations_created`, `idx_po_date`, **`vendor_products.vendor_sku` trigram (no index exists today)**, `idx_invoices_po_unique`. | med | S | N |
| 19 | **`POST /items/match-rows` unbounded batch** — 1–3 sequential queries per row, rows created non-transactionally. *Just cap the batch at a few hundred → 422 (an afternoon); the JSONB rewrite is unprofiled premature optimization.* | high | S/L | Y |
| 20 | **Product search paginates a hard-capped 100-row client-side slice** — the count shown is wrong and results past 100 are unreachable (vendor detail truncates at 50). | med | M | Y |
| 21 | **Per-client/per-vendor cumulative revenue returned to every role** — the financial-visibility rule lives only inside `internal/dashboard`. | med | M | Y |

### Tier 3 — maintainability (see §5, §6)

Ranks 22–30: duplicated list-query builder (7 repos), triplicated `parseIfMatch` (1
divergent), plpgsql with no canonical source, list-state duplicated across 6 screens, a
`Page`/`makePageNavigate` layer shadowing the router, asset weight (a 294KB logo at 28px,
render-blocking Google Fonts), and a latent cluster (sentinel-zero user id, quotation
DELETE+reinsert with `ON DELETE SET NULL`, missing `invoices.po_id UNIQUE`, `profit_pct`
overflow, unpurged refresh tokens, `orphan-blobs` binary not in the image).

---

## 5. Duplication hotspots

- **List-query builder** — the same ~40-line `args`/`addArg`/`where`/sort-switch/limit-clamp
  block in 7 repos (`clients/repo.go:86`, `users:114`, `items:73`, `vendors:86`,
  `quotations:111`, `purchaseorders:99`, `invoices:122`), each hardcoding `if limit > 200`
  which **shadows `paginate.MaxLimit`** — changing the constant changes nothing.
- **`parseIfMatch` triplicated** (`quotations:217`, `purchaseorders:339`, `invoices:264`);
  the invoices copy is **missing** `strings.Trim(raw, "\"")`, so `If-Match: "5"` succeeds
  on quotations/POs and 400s on invoices. Belongs in `shared/httpx`.
- **Role strings re-typed as literals** instead of `users.RoleSuperadmin/...`;
  `CurrentUserRole` returns bare `string`, so a rename compiles clean while failing open.
- **Frontend list-state block duplicated 6×** and already drifting (VendorList has
  sort keys, ClientList doesn't).
- **Colour literals** — 880 hardcoded `#RRGGBB` vs 3 uses of `var(--)`; `#630ED4` appears
  123× and isn't even in `design-tokens.css`. Three competing colour sources.
- **Route-adapter boilerplate** — `onNavigate`/`onLogout` threaded through 25 feature
  components / 134 references via the legacy `Page` layer.
- **Cross-slice repo construction** builds concrete `*clients.Repo` in three `routes.go`
  files; a signature change is a four-package edit.

---

## 6. Corrected / overturned claims (honesty section)

The critic verified against files and overturned these — do not act on the original
framing:

1. **Trigram operator rewrite is NOT "zero-risk / result-preserving."** `<%` means
   `word_similarity >= pg_trgm.word_similarity_threshold` (**default 0.6**), but the code
   uses literals `> 0.40` (vendor name) and `> 0.30` (request history), and **no GUC is
   set anywhere**. Rewriting silently raises the cutoff to 0.6 → large recall regression
   on the primary typeahead. Keep the function form OR pair the rewrite with an explicit
   `set_limit()`/`word_similarity_threshold` and a before/after recall diff. Only the
   **index additions** are safe.
2. **CORS `*` is overstated.** `AllowCredentials: false` + token-in-`sessionStorage` means
   a wildcard origin only permits *unauthenticated* cross-origin calls — it can't ride a
   session or read the token. Real, but not a Phase-1 emergency. (The superadmin-password
   half of that finding is fully real.)
3. **Storage: no invoice-attachment read escalation.** Keys are
   `{prefix}/{id}/{unix-ts}-{name}` (non-enumerable) and `/invoices` is gated. The
   **write** primitive + PO-doc overwrite + missing CSP + disk-fill DoS are the real bugs.
4. **Client-count timezone miscount probably not live** — compose sets
   `TZ`/`PGTZ: Asia/Jakarta`; `initdb` derives the GUC from it. Verify `SHOW timezone`
   first; pinning TZ at the pool has whole-app blast radius (`CURRENT_DATE`, invoice
   dates, numbering).
5. **The react-dom "130KB stranded" figure is unmeasured** and mechanically implausible
   (`react-dom/client` re-imports `react-dom`). Fix the one-line `manualChunks` config;
   don't sell it on a number nobody measured.
6. **`Roles()` registry, `/metrics` on a separate listener, the `listq` Builder,
   cross-slice ports, `token_version`, the JSONB match-rows rewrite, and per-route
   `validateSearch`** are over-engineering for this app. The boring equivalents (a
   table-driven router test; two log lines; deleting 7 clamp blocks; shorter JWT expiry;
   a batch cap; product backlog) deliver the value.

---

## 7. Refactor strategy (re-sequenced per critic)

Each phase ends green at `make test` and is independently shippable.

**Phase 1 — Fail-closed security (half a day).** `JWT_SECRET` `required,notEmpty` + ≥32-byte
guard [#1]. Drop the `SUPERADMIN_PASSWORD` default, require it, `CHANGE_ME` in
`.env.example` [#2]. **Fix `RealIP`** — drop it (single trusted proxy) or trust only XFF
last-hop from a known CIDR; strip `True-Client-IP`/`X-Real-IP` at Traefik; add a
**per-account** login counter [#3]. Wrap the two mounts with `requireRole` **+ a
table-driven `{role→status}` router test in the same commit** [#4]. `queryClient.clear()`
on logout [#12]. — *Note: do NOT drop `JWT_EXPIRY` to 15m here; it multiplies refresh
traffic ~96× against the unfixed reuse bug #7. Cut `REFRESH_TOKEN_EXPIRY` instead for a
session-length win.*

**Phase 2 — Storage authorization (immediately after P1; best effort-to-risk).** Bucket→role
map + filename validation on `Put`, `Content-Disposition: attachment` + extension-derived
`Content-Type` on `Get`, include the disk-fill cap. Add CSP + `X-Frame-Options` [#5].

**Phase 3 — Safe performance (result sets provably unchanged).** One `NO TRANSACTION`
migration adding the five indexes [#18]. **Not** the trigram operator rewrite (see §6.1).
Frontend, same mechanical batch: resize + import the logo, self-host Inter, fix
`manualChunks`, hoist Sidebar's icon record to module scope. Verify with `EXPLAIN`
before/after.

**Phase 4 — Money & date correctness (protect the tax filing).** Extract canonical
`db/functions/*.sql` first (reviewable diff). New migration converting **all three**
invoice columns (`dpp_nilai_lain`, `ppn_amount`, `total`) to plain columns populated as
`SUM(ROUND(line))`, with the test asserting `total == dpp_nilai_lain + ppn_amount ==
sum(lines)` [#6]. `NOW()` → `CURRENT_DATE` in `invoices.summary` [#8a]. Decide the backfill
question first (§8).

**Phase 5 — Error & resilience.** Split `RenderDBErr` into log-truth / return-curated
(+request id in `Error.Instance`); fix all 4 `err.Error()` leak sites [#11]. Query
`throwOnError: true` + one shared error state [#13]. `/readyz` + compose healthcheck [#16].

**Phase 6 — Deploy hardening.** goose session locker first, then the one-shot migrate
container with `--bootstrap` [#15]. pdfgen semaphore + wire `Renderer.timeout` + exempt
PDF routes from the 30s + `deploy.resources.limits` [#14]. Delete MinIO Traefik labels
[#17]. Add `LOG_LEVEL` + `user_id` in the access log (the audit-trail value; skip the
`/metrics` wiring).

**Phase 7 — Transactions & batch safety.** Move the unpriced check inside
`fn_change_quotation_status` (removes the TOCTOU, no Go tx) [#10]; have `fn_update_quotation`
RETURN `row_version`; wrap refresh redeem+insert in one tx + a ~10s reuse grace [#7]. Cap
`/items/match-rows` [#19].

**Phase 8 — Maintainability (last, pure refactor).** Delete 7 hardcoded `200` clamps → call
`paginate.MaxLimit`; move `parseIfMatch` to `shared/httpx`; `requireRole`/`CurrentUserRole`
take `users.Role`. Frontend: render Sidebar once in `_authed.tsx`, delete `lib/page.ts` +
`page-nav.ts`, one `useListSearchState`, server-side product search paging [#20].

**Phase 9 — Decide & delete.** Remove tailwind (3 incidental classes; CLAUDE.md says plain
CSS). Delete or fix `openapi.yaml`. Reconcile `design-tokens.css` to the `#630ED4`
actually shipping and migrate the ~100 lines of shared chip/dropdown styles to `var(--)`
(not all 880 literals).

---

## 8. Proposed folder structure

**Almost nothing moves — the layout is correct for this app's size.** Explicitly rejected:
ORM/sqlc, an i18n layer, a CSS framework, a `domain/application/infrastructure` split, and
any per-feature `service.go`. Four additive/deletive changes:

```
apps/api/internal/shared/
  listq/            NEW  Builder for the filtered/sorted/paged assembly (7 copies today)
  httpx/etag.go     NEW FILE in an existing package — parseIfMatch (3 copies, 1 divergent)
apps/api/db/
  functions/*.sql   NEW  canonical CURRENT body of each plpgsql fn (reviewable, diffable);
                         migrations keep deploying them, stay append-only
apps/web/src/
  lib/page.ts       DELETE  18-member union shadowing the router
  lib/page-nav.ts   DELETE
  lib/useListSearchState.ts  NEW  one hook replacing the 6-copy list-state block
  routes/_authed.tsx CHANGE  render <Sidebar/> here above <Outlet/> — removes
                             onNavigate/onLogout from 25 components AND fixes the
                             per-keystroke Sidebar re-render
```

---

## 9. Behavior-change decisions (I need your call before touching these)

Grouped by phase. Each alters what users see or can do.

**Security (Phase 1–2):**
- Refuse to boot when `JWT_SECRET` is empty/<32 bytes, and when `SUPERADMIN_PASSWORD` is
  unset in production? (loud deploy failure instead of silent weak default)
- **Remove finance access to `/quotations` and `/purchase-orders`?** CLAUDE.md says they
  shouldn't have it — but confirm no finance account relies on it via a direct link today.
- `/storage/object`: enforce bucket→role (operational loses invoice-attachment access) +
  force download `Content-Disposition` (changes how attachments open in the browser)?

**Tax / dates (Phase 4):**
- Make invoice header PPN/DPP the SUM of per-line rounded values (changes the printed
  figure by up to 0.01/line)?
- **Backfill existing invoices** to the new totals, or apply forward-only? (backfilling
  restates documents already issued to customers — an AR change, not just a bug fix.)
- Switch overdue/due-soon from `NOW()` to `CURRENT_DATE` (an invoice due today stops
  counting as overdue)?

**Sessions (Phase 1/7):**
- Clear the whole React Query cache on logout (re-fetch instead of instant cached lists)?
- Cut `REFRESH_TOKEN_EXPIRY` (bounds session length; no refresh-frequency change)?
- Stop revoking all sessions on a concurrent/retried refresh (accept a ~10s window where a
  truly replayed token gets a plain 401)?

**UX / limits (Phase 5–8):**
- Failed queries show "gagal memuat" instead of an empty state?
- Curated error toasts instead of raw Postgres text?
- Cap `/items/match-rows` at a few hundred rows → 422 (breaks a larger single-import)?
- Server-side product search paging (correct counts; all results reachable)?
- Omit `totalPurchase`/vendor-spend for operational users (removes those columns)?
- PDF concurrency cap returning 503 when saturated?
- Migration moves to a one-shot container that must succeed before the API starts?
- List filters/search/pagination move into the URL (Back + bookmarks work)?
