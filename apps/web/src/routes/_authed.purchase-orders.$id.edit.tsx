import { createFileRoute } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { usePurchaseOrderByQuotation } from "@/features/purchaseOrders/hooks"
import { poEditLockReason } from "@/features/purchaseOrders/PurchaseOrderDetail/helpers"
import PurchaseOrderEdit from "@/features/purchaseOrders/PurchaseOrderEdit"
import { isMissing } from "@/lib/errors"
import { compact, positiveInt } from "@/lib/list-search"

// Step and line to open
type EditSearch = { step?: number; line?: number }

export const Route = createFileRoute("/_authed/purchase-orders/$id/edit")({
  validateSearch: (search: Record<string, unknown>): EditSearch =>
    compact({
      step: positiveInt(search.step, 3),
      line: positiveInt(search.line, Number.MAX_SAFE_INTEGER),
    }),
  component: PurchaseOrderEditRoute,
})

// $id is the quotation id.
//
// As on the detail route.
function PurchaseOrderEditRoute() {
  const { id } = Route.useParams()
  const { step, line } = Route.useSearch()
  const numericId = Number(id)
  const quotationId = Number.isInteger(numericId) && numericId > 0 ? numericId : undefined
  const { data: po, isLoading, error, refetch } = usePurchaseOrderByQuotation(quotationId)

  if (!po) {
    if (isLoading) return <LoadingState label="Memuat data Purchase Order…" />
    if (error && !isMissing(error)) {
      return <RouteErrorFallback error={error} reset={() => void refetch()} />
    }
    return (
      <NotFoundState
        title="Purchase Order Tidak Ditemukan"
        size="page"
        backTo={{ to: "/purchase-orders", label: "Kembali ke Daftar Purchase Order" }}
      />
    )
  }

  const lockReason = poEditLockReason(po)
  if (lockReason) {
    return (
      <NotFoundState
        title="Purchase Order Tidak Dapat Diubah"
        description={lockReason}
        size="page"
        backTo={{ to: "/purchase-orders", label: "Kembali ke Daftar Purchase Order" }}
      />
    )
  }

  // Keyed so another PO starts a fresh form.
  return <PurchaseOrderEdit key={po.id} po={po} startStep={step} startLine={line} />
}
