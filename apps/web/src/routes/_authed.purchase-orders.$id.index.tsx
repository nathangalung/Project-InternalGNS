import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { clientCardInfo } from "@/features/clients/clientCard"
import { useClient, useClientContacts } from "@/features/clients/hooks"
import { usePurchaseOrderByQuotation } from "@/features/purchaseOrders/hooks"
import PurchaseOrderDetail from "@/features/purchaseOrders/PurchaseOrderDetail"
import { toQuotationData } from "@/features/quotations/adapters"
import { useQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { isMissing } from "@/lib/errors"

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
  const { data: client } = useClient(po?.companyClientId)
  const { data: contacts } = useClientContacts(po?.companyClientId)

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of units ?? []) map.set(u.id, u.code)
    return (unitId?: number) => (unitId !== undefined ? (map.get(unitId) ?? "") : "")
  }, [units])

  const quotation = useMemo(() => {
    if (!detail) return undefined
    const q = toQuotationData(detail, unitOf)
    return {
      ...q,
      clientInfo: clientCardInfo(q.clientInfo ?? {}, client, contacts, detail.contactId),
    }
  }, [detail, unitOf, client, contacts])

  if (!po) {
    if (isLoading) return <LoadingState label="Memuat data Purchase Order…" />
    // A bad id is missing; the rest can retry.
    if (error && !isMissing(error)) {
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
      quotation={quotation}
      onEdit={() => void navigate({ to: "/purchase-orders/$id/edit", params: { id } })}
    />
  )
}
