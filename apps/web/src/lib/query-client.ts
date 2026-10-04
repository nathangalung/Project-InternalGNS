import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api-client"

// Retry once, never a 4xx.
//
// A 404 or 403 will not change on a second try, and retrying one only delays
// the not-found or error state by a second.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 1
}

export type LookupOptions = { throwOnError?: false }

// Lookup kept out of boundary.
//
// For a lookup inside a form or dialog whose unsaved input the route error
// boundary would discard.
export const INLINE_LOOKUP = { throwOnError: false } as const satisfies LookupOptions

// A lookup's boundary opt-out.
//
// Spread into useQuery options. An absent key leaves the client default,
// which an explicit undefined key would override.
export function lookupThrow({ throwOnError }: LookupOptions): LookupOptions {
  return throwOnError === false ? { throwOnError } : {}
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
      // Real failures reach the boundary.
      //
      // Network errors and 5xx go to the route error boundary so an outage
      // shows an error instead of an empty "no data" state; handled 4xx pass
      // through for components to render inline.
      throwOnError: (error) => !(error instanceof ApiError) || error.status >= 500,
    },
    mutations: {
      retry: 0,
    },
  },
})
