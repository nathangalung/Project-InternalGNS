import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query"
import { act, type ReactNode } from "react"
import { vi } from "vitest"
import { renderHook } from "./renderHook"

// Isolated client, no retries.
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
}

// Hook inside a query provider.
export function renderQueryHook<R>(hook: () => R, qc: QueryClient = testQueryClient()) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, ...renderHook(() => hook(), undefined, Wrapper) }
}

// Retry a check between renders.
export async function until(check: () => void): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {})
    check()
  })
}

// Run a mutation to completion.
export async function settle(run: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await run().catch(() => {})
  })
}

// Seed keys to watch invalidation.
export function seed(qc: QueryClient, keys: QueryKey[]): void {
  for (const key of keys) qc.setQueryData(key, { seeded: true })
}

// Keys marked stale by a mutation.
export function invalidated(qc: QueryClient, keys: QueryKey[]): QueryKey[] {
  return keys.filter((key) => qc.getQueryState(key)?.isInvalidated)
}
