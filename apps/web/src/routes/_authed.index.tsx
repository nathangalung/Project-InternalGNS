import { createFileRoute } from "@tanstack/react-router"
import Dashboard from "@/features/dashboard/Dashboard"

export const Route = createFileRoute("/_authed/")({
  component: DashboardRoute,
})

function DashboardRoute() {
  return <Dashboard />
}
