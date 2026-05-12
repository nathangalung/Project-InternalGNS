import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import InvoiceList from "@/features/invoices/InvoiceList"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/invoices/")({
  component: InvoiceListRoute,
})

function InvoiceListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <InvoiceList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(qid) => void navigate({ to: "/invoices/$id", params: { id: String(qid) } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
