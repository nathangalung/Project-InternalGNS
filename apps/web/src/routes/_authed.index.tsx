import { createFileRoute, useNavigate } from "@tanstack/react-router"
import Dashboard from "@/features/dashboard/Dashboard"
import { useAuth } from "@/features/auth/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/")({
  component: DashboardRoute,
})

function DashboardRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <Dashboard
      onNavigate={makePageNavigate(navigate)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
