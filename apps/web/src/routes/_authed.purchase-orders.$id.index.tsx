import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { usePurchaseOrderByQuotation } from "@/features/purchaseOrders/hooks"
import PurchaseOrderDetail from "@/features/purchaseOrders/PurchaseOrderDetail"
import { toQuotationData } from "@/features/quotations/adapters"
import { useQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { ApiError } from "@/lib/api-client"

export const Route = createFileRoute("/_authed/purchase-orders/$id/")({
  component: PurchaseOrderDetailRoute,
})

// $id is the quotation id.
function PurchaseOrderDetailRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const numericId = Number(id)
  const quotationId = Number.isInteger(numericId) && numericId > 0 ? numericId : undefined
  const { data: po, isLoading, error, refetch } = usePurchaseOrderByQuotation(quotationId)
  // Client card only; the PO carries its own figures.
  const { data: detail } = useQuotation(po ? quotationId : undefined)
  const { data: units } = useUnits()

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of units ?? []) map.set(u.id, u.code)
    return (unitId?: number) => (unitId !== undefined ? (map.get(unitId) ?? "") : "")
  }, [units])

  if (!po) {
    if (isLoading) return <LoadingState label="Memuat data Purchase Order…" />
    // A bad id is missing; the rest can retry.
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

  return (
    <PurchaseOrderDetail
      po={po}
      quotation={detail ? toQuotationData(detail, unitOf) : undefined}
      onEdit={() => void navigate({ to: "/purchase-orders/$id/edit", params: { id } })}
    />
  )
}
