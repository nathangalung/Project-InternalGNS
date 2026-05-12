import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import Dashboard from "@/features/dashboard/Dashboard"
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
