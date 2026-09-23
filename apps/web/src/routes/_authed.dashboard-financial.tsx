import { createFileRoute, useNavigate } from "@tanstack/react-router"
import DashboardFinancial from "@/features/dashboard/DashboardFinancial"

export const Route = createFileRoute("/_authed/dashboard-financial")({
  component: DashboardFinancialRoute,
})

function DashboardFinancialRoute() {
  const navigate = useNavigate()

  return <DashboardFinancial onViewAllInvoices={() => void navigate({ to: "/invoices" })} />
}
