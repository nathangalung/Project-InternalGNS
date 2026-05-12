import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import PurchaseOrderList from "@/features/purchaseOrders/PurchaseOrderList"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/purchase-orders/")({
  component: PurchaseOrderListRoute,
})

function PurchaseOrderListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <PurchaseOrderList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(qid) =>
        void navigate({ to: "/purchase-orders/$id", params: { id: String(qid) } })
      }
      onViewQuotation={(qid) =>
        void navigate({ to: "/quotations/$id", params: { id: String(qid) } })
      }
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
