import { createFileRoute, useNavigate } from "@tanstack/react-router"
import PurchaseOrderList from "@/features/purchaseOrders/PurchaseOrderList"

export const Route = createFileRoute("/_authed/purchase-orders/")({
  component: PurchaseOrderListRoute,
})

function PurchaseOrderListRoute() {
  const navigate = useNavigate()

  return (
    <PurchaseOrderList
      onViewDetail={(qid) =>
        void navigate({ to: "/purchase-orders/$id", params: { id: String(qid) } })
      }
      onViewQuotation={(qid) =>
        void navigate({ to: "/quotations/$id", params: { id: String(qid) } })
      }
    />
  )
}
