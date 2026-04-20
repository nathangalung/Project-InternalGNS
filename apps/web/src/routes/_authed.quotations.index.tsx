import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationList from "@/components/quotation/QuotationList"
import { useAuth } from "@/hooks/use-auth"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/quotations/")({
  component: QuotationListRoute,
})

function QuotationListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <QuotationList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(id) => void navigate({ to: "/quotations/$id", params: { id } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
