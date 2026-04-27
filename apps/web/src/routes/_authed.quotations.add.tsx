import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationAdd from "@/features/quotations/QuotationAdd"
import { useAuth } from "@/features/auth/hooks"
import { makePageNavigate } from "@/lib/page-nav"

// Path has no $id.
export const Route = createFileRoute("/_authed/quotations/add")({
  component: QuotationAddRoute,
})

function QuotationAddRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <QuotationAdd
      // No id needed for makePageNavigate.
      onNavigate={makePageNavigate(navigate)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
