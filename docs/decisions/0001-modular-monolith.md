# ADR 0001 — Modular monolith in Go, single binary

Date: 2026-04-20
Status: Accepted

## Context

- Small team, single Dokploy VPS hosting 3+ apps.
- Workload: internal CRUD + fuzzy item matching + document generation.
  Modest concurrency, moderate data (tens of thousands of quotations/year).
- Existing schema is cohesive, with cross-module joins (pricing reads
  `items` + `vendor_products`; quotation create writes `quotations` +
  `quotation_items` + `audit_logs`).
- No ML, no event-driven requirements.

## Decision

Single Go binary (`apps/api`) organized into domain modules under
`internal/<domain>`. Each module owns its tables, queries, service, and HTTP
routes. Shared plumbing lives in `internal/shared/`.

## Consequences

- **+** Trivial local dev (`go run ./cmd/api`).
- **+** Cross-module calls are in-process function calls — no network, no
  serialization cost, no distributed tracing overhead.
- **+** One container to deploy; one logs stream; one migration run.
- **−** Cannot scale modules independently. Mitigation: not needed at this
  scale; the seam is kept clean so a worker split (`cmd/api` + `cmd/worker`)
  or a module extraction is a focused refactor, not a rewrite.
- **−** Module boundaries rely on discipline, not enforcement. Mitigation:
  `internal/shared/` is the only cross-module dependency; domain modules
  import siblings only through exported interfaces.

## Alternatives considered

- **Microservices.** Rejected: ops burden (multiple Dockerfiles, service
  discovery, distributed tx for quotation→audit writes) outweighs any
  benefit at current team size.
- **Go API + Python ML service.** Rejected: requirements are SQL-shaped
  (pg_trgm + ranking + business rules). No embeddings needed.
