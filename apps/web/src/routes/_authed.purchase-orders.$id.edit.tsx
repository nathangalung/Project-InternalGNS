import { createFileRoute } from "@tanstack/react-router"
import PurchaseOrderEdit from "@/features/purchaseOrders/PurchaseOrderEdit"

export const Route = createFileRoute("/_authed/purchase-orders/$id/edit")({
  component: PurchaseOrderEditRoute,
})

function PurchaseOrderEditRoute() {
  const { id } = Route.useParams()

  return <PurchaseOrderEdit poId={id} />
}
