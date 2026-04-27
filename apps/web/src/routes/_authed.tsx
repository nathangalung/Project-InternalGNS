import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { isAuthenticatedSync } from "@/features/auth/hooks"

export const Route = createFileRoute("/_authed")({
  beforeLoad: () => {
    if (!isAuthenticatedSync()) throw redirect({ to: "/login" })
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  return <Outlet />
}
