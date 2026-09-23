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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
      // Surface real failures (network errors, 5xx) to the route error boundary
      // so an outage shows an error instead of an empty "no data" state; let
      // handled 4xx pass through for components to render inline.
      throwOnError: (error) => !(error instanceof ApiError) || error.status >= 500,
    },
    mutations: {
      retry: 0,
    },
  },
})
