import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationList from "@/features/quotations/QuotationList"
import { useAuth } from "@/features/auth/hooks"
import { useQuotations } from "@/features/quotations/hooks"
import { toTableRow } from "@/features/quotations/adapters"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/quotations/")({
  component: QuotationListRoute,
})

function QuotationListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { data } = useQuotations({ limit: 200 })
  const rows = data && data.length > 0 ? data.map(toTableRow) : undefined

  return (
    <QuotationList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(id) => void navigate({ to: "/quotations/$id", params: { id } })}
      rows={rows}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
