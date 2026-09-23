import { createFileRoute, useNavigate } from "@tanstack/react-router"
import DashboardOperational from "@/features/dashboard/DashboardOperational"

export const Route = createFileRoute("/_authed/dashboard-operational")({
  component: DashboardOperationalRoute,
})

function DashboardOperationalRoute() {
  const navigate = useNavigate()

  return <DashboardOperational onViewAllQuotations={() => void navigate({ to: "/quotations" })} />
}
