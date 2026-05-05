import { createFileRoute, useNavigate } from "@tanstack/react-router"
import DashboardOperational from "@/features/dashboard/DashboardOperational"
import { useAuth } from "@/features/auth/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/dashboard-operational")({
  component: DashboardOperationalRoute,
})

function DashboardOperationalRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <DashboardOperational
      onNavigate={makePageNavigate(navigate)}
      onViewQuotation={qid => void navigate({ to: "/quotations/$id", params: { id: String(qid) } })}
      onViewAllQuotations={() => void navigate({ to: "/quotations" })}
      onViewAllInvoices={() => void navigate({ to: "/invoices" })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
