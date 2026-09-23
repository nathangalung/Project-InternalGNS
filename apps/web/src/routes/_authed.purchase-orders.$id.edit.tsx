import { createFileRoute } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { usePurchaseOrderByQuotation } from "@/features/purchaseOrders/hooks"
import { isPoLocked } from "@/features/purchaseOrders/PurchaseOrderDetail/helpers"
import PurchaseOrderEdit from "@/features/purchaseOrders/PurchaseOrderEdit"
import { ApiError } from "@/lib/api-client"

export const Route = createFileRoute("/_authed/purchase-orders/$id/edit")({
  component: PurchaseOrderEditRoute,
})

// $id is the quotation id, as on the detail route.
function PurchaseOrderEditRoute() {
  const { id } = Route.useParams()
  const numericId = Number(id)
  const quotationId = Number.isInteger(numericId) && numericId > 0 ? numericId : undefined
  const { data: po, isLoading, error, refetch } = usePurchaseOrderByQuotation(quotationId)

  if (!po) {
    if (isLoading) return <LoadingState label="Memuat data Purchase Order…" />
    if (error && !(error instanceof ApiError && (error.status === 400 || error.status === 404))) {
      return <RouteErrorFallback error={error} reset={() => void refetch()} />
    }
    return (
      <NotFoundState
        title="Purchase Order tidak ditemukan"
        size="page"
        backTo={{ to: "/purchase-orders", label: "Kembali ke Daftar Purchase Order" }}
      />
    )
  }

  if (isPoLocked(po.status)) {
    return (
      <NotFoundState
        title="Purchase Order tidak dapat diubah"
        description="PO yang sudah dikirim atau dibatalkan tidak dapat diubah."
        size="page"
        backTo={{ to: "/purchase-orders", label: "Kembali ke Daftar Purchase Order" }}
      />
    )
  }

  // Keyed so another PO starts a fresh form.
  return <PurchaseOrderEdit key={po.id} po={po} />
}
