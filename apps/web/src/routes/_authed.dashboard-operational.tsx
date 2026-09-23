import { createFileRoute } from "@tanstack/react-router"
import DashboardOperational from "@/features/dashboard/DashboardOperational"

export const Route = createFileRoute("/_authed/dashboard-operational")({
  component: DashboardOperationalRoute,
})

function DashboardOperationalRoute() {
  return <DashboardOperational />
}
