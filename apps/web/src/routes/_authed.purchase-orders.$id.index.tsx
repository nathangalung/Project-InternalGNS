import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { useMe } from "@/features/auth/hooks"
import { clientCardInfo, documentContact } from "@/features/clients/clientCard"
import { useClient } from "@/features/clients/hooks"
import { usePurchaseOrderByQuotation } from "@/features/purchaseOrders/hooks"
import PurchaseOrderDetail from "@/features/purchaseOrders/PurchaseOrderDetail"
import { useQuotation } from "@/features/quotations/hooks"
import { useTrailState } from "@/hooks/useNavTrail"
import { isMissing } from "@/lib/errors"
import { roleCanAccess } from "@/lib/rbac"

export const Route = createFileRoute("/_authed/purchase-orders/$id/")({
  component: PurchaseOrderDetailRoute,
})

// $id is the quotation id.
function PurchaseOrderDetailRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const state = useTrailState()

  const numericId = Number(id)
  const quotationId = Number.isInteger(numericId) && numericId > 0 ? numericId : undefined
  const { data: po, isLoading, error, refetch } = usePurchaseOrderByQuotation(quotationId)
  // The client card is the PO's own client and narahubung, which can differ
  // from the quotation's. Only the client's reference comes from the
  // quotation; finance input reads POs but not quotations, so its card goes
  // without it. The id is the quotation's, so it loads beside the PO; a
  // missing one is a 404 that stays out of the error boundary.
  const readsQuotation = roleCanAccess(useMe().data?.role, "quotation")
  const { data: detail } = useQuotation(readsQuotation ? quotationId : undefined)
  const { data: client } = useClient(po?.companyClientId)

  const clientInfo = useMemo(
    () =>
      po
        ? clientCardInfo(
            { narahubung: po.contactName, referenceNumber: detail?.clientRefNo },
            client,
            documentContact(po),
          )
        : undefined,
    [po, detail?.clientRefNo, client],
  )

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
      clientInfo={clientInfo}
      onEdit={() => void navigate({ to: "/purchase-orders/$id/edit", params: { id }, state })}
    />
  )
}
