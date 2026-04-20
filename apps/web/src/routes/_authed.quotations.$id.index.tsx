import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationDetail from "@/components/quotation/QuotationDetail"
import { useAuth } from "@/hooks/use-auth"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/quotations/$id/")({
  component: QuotationDetailRoute,
})

function QuotationDetailRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <QuotationDetail
      quotationId={id}
      onNavigate={makePageNavigate(navigate, id)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
