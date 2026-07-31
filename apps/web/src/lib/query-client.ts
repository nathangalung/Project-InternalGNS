import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "@/lib/api-client"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
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
