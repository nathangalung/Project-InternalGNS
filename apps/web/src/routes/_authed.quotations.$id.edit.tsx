import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationEdit from "@/components/quotation/QuotationEdit"
import { useAuth } from "@/hooks/use-auth"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/quotations/$id/edit")({
  component: QuotationEditRoute,
})

function QuotationEditRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <QuotationEdit
      quotationId={id}
      onNavigate={makePageNavigate(navigate, id)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
