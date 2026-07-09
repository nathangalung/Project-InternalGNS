import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import * as authApi from "@/features/auth/api"
import { clearAuthState, isAuthenticatedSync } from "@/features/auth/hooks"
import { queryKeys } from "@/lib/query-keys"
import { roleCanAccess, sectionFromPathname } from "@/lib/rbac"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    if (!isAuthenticatedSync()) throw redirect({ to: "/login" })
    let me: Awaited<ReturnType<typeof authApi.me>>
    try {
      me = await context.queryClient.fetchQuery({
        queryKey: queryKeys.auth.me(),
        queryFn: authApi.me,
        staleTime: 5 * 60 * 1000,
      })
    } catch {
      clearAuthState()
      throw redirect({ to: "/login" })
    }
    // Typed URLs respect the role matrix.
    if (!roleCanAccess(me.role, sectionFromPathname(location.pathname))) {
      throw redirect({ to: "/" })
    }
  },
  component: AuthedLayout,
  errorComponent: ({ error, reset }) => <RouteErrorFallback error={error} reset={reset} />,
})

function AuthedLayout() {
  return <Outlet />
}
