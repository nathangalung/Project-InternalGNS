import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import PurchaseOrderDetail from "@/features/purchaseOrders/PurchaseOrderDetail"
import { useAuth } from "@/features/auth/hooks"
import { useQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { toQuotationData } from "@/features/quotations/adapters"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/purchase-orders/$id/")({
  component: PurchaseOrderDetailRoute,
})

function PurchaseOrderDetailRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const { logout } = useAuth()

  const numericId = Number(id)
  const hasNumericId = Number.isFinite(numericId) && numericId > 0
  const { data: detail } = useQuotation(hasNumericId ? numericId : undefined)
  const { data: units } = useUnits()

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of units ?? []) map.set(u.id, u.code)
    return (unitId?: number) => (unitId !== undefined ? map.get(unitId) ?? "" : "")
  }, [units])

  const quotation = detail ? toQuotationData(detail, unitOf) : undefined

  return (
    <PurchaseOrderDetail
      quotationId={numericId}
      quotationNo={detail?.quotationNo ?? id}
      quotation={quotation}
      onNavigate={makePageNavigate(navigate, id)}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
