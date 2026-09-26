# ADR 0003 — TypeScript 7 native compiler

Date: 2026-09-26
Status: Accepted

## Context

- TypeScript 7 is the Go port of the compiler. The `typescript` package now
  ships a small `tsc` shim plus a statically linked native binary, pulled in
  per platform through `@typescript/typescript-<os>-<cpu>` optional
  dependencies.
- 7.0 removes `baseUrl`. TypeScript 6 was the deprecation bridge and failed
  on it (TS5101), so the 6.0.3 commit dropped it; the `@/*` paths entry is
  relative to the tsconfig and no import relied on it.
- 7.0 ships only `tsc`: no `tsserver` and no programmatic compiler API (that
  is planned for 7.1). Nothing in `bun.lock` imports `typescript` as a
  library; Vite, Vitest, Biome, tsr and Playwright strip or parse types on
  their own.

## Decision

- Move to `typescript` ^7.0.2 with the tsconfigs unchanged. `tsc -b` still
  builds the `tsconfig.node.json` reference (`composite`,
  `emitDeclarationOnly`) and emits `vite.config.d.ts`; both
  `tsc --noEmit -p` calls in `typecheck` pass with no new errors.

## Consequences

- **+** `tsc --noEmit -p tsconfig.json` drops from about 5.9 s to 0.6 s.
- **+** The native binary is statically linked, so it runs in the
  `oven/bun` alpine build stage as well as on the glibc CI runner.
- **−** Editors cannot select the workspace TypeScript version, because the
  package has no `tsserver`. They use their bundled TypeScript (5.x or 6.x)
  or the TypeScript native preview extension, so editor diagnostics can
  differ slightly from `bun run typecheck`, which stays the gate.
- **−** A new platform needs its `@typescript/typescript-*` binary resolved
  in `bun.lock`; the lock records the full set, so frozen installs work on
  every platform the package supports.

## Alternatives considered

- **Stay on 6.0.3.** Rejected: 6.x is the last JavaScript line and exists to
  bridge to 7; staying buys nothing once the config is clean.
- **Keep 6.x beside `@typescript/native-preview`.** Rejected: the preview is
  dev builds only and is superseded by `typescript@7`.
