import { createFileRoute, useNavigate } from "@tanstack/react-router"
import PurchaseOrderEdit from "@/features/purchaseOrders/PurchaseOrderEdit"
import { useAuth } from "@/features/auth/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/purchase-orders/$id/edit")({
  component: PurchaseOrderEditRoute,
})

function PurchaseOrderEditRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <PurchaseOrderEdit
      quotationId={id}
      onNavigate={makePageNavigate(navigate, id)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
