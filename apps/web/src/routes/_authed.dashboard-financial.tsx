import { createFileRoute, useNavigate } from "@tanstack/react-router"
import DashboardFinancial from "@/features/dashboard/DashboardFinancial"
import { useAuth } from "@/features/auth/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/dashboard-financial")({
  component: DashboardFinancialRoute,
})

function DashboardFinancialRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <DashboardFinancial
      onNavigate={makePageNavigate(navigate)}
      onViewInvoice={qid => void navigate({ to: "/invoices/$id", params: { id: String(qid) } })}
      onViewAllInvoices={() => void navigate({ to: "/invoices" })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
