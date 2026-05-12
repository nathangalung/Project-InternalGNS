import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { isAuthenticatedSync } from "@/features/auth/hooks"

export const Route = createFileRoute("/_authed")({
  beforeLoad: () => {
    if (!isAuthenticatedSync()) throw redirect({ to: "/login" })
  },
  component: AuthedLayout,
  errorComponent: ({ error, reset }) => <RouteErrorFallback error={error} reset={reset} />,
})

function AuthedLayout() {
  return <Outlet />
}
