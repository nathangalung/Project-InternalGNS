import { createFileRoute } from "@tanstack/react-router"
import DashboardFinancial from "@/features/dashboard/DashboardFinancial"

export const Route = createFileRoute("/_authed/dashboard-financial")({
  component: DashboardFinancialRoute,
})

function DashboardFinancialRoute() {
  return <DashboardFinancial />
}
