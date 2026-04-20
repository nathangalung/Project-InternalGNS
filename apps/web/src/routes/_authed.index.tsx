import { createFileRoute, useNavigate } from "@tanstack/react-router"
import MainDashboard from "@/components/dashboard/MainDashboard"
import { useAuth } from "@/hooks/use-auth"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/")({
  component: DashboardRoute,
})

function DashboardRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <MainDashboard
      onNavigate={makePageNavigate(navigate)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
