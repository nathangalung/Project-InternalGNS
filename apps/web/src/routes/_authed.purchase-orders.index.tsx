import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { validatePoSearch } from "@/features/purchaseOrders/list-search"
import PurchaseOrderList from "@/features/purchaseOrders/PurchaseOrderList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/purchase-orders/")({
  validateSearch: validatePoSearch,
  component: PurchaseOrderListRoute,
})

function PurchaseOrderListRoute() {
  const navigate = useNavigate()
  const state = useTrailState()

  return (
    <PurchaseOrderList
      onViewDetail={(qid) =>
        void navigate({ to: "/purchase-orders/$id", params: { id: String(qid) }, state })
      }
    />
  )
}
