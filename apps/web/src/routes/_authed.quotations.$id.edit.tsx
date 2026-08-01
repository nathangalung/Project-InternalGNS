import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import QuotationEdit from "@/features/quotations/QuotationEdit"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/quotations/$id/edit")({
  component: QuotationEditRoute,
})

function QuotationEditRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { logout } = useAuth()

  // Keyed so switching quotations remounts the wizard with fresh state, while a
  // background refetch of the same quotation keeps entered steps.
  return (
    <QuotationEdit
      key={id}
      quotationId={id}
      onNavigate={makePageNavigate(navigate, id)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
