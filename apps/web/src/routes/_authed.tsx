import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import * as authApi from "@/features/auth/api"
import { clearAuthState, isAuthenticatedSync } from "@/features/auth/hooks"
import { queryKeys } from "@/lib/query-keys"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context }) => {
    if (!isAuthenticatedSync()) throw redirect({ to: "/login" })
    try {
      await context.queryClient.fetchQuery({
        queryKey: queryKeys.auth.me(),
        queryFn: authApi.me,
        staleTime: 5 * 60 * 1000,
      })
    } catch {
      clearAuthState()
      throw redirect({ to: "/login" })
    }
  },
  component: AuthedLayout,
  errorComponent: ({ error, reset }) => <RouteErrorFallback error={error} reset={reset} />,
})

function AuthedLayout() {
  return <Outlet />
}
