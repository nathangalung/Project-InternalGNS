import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { clientCardInfo } from "@/features/clients/clientCard"
import { useClient, useClientContacts } from "@/features/clients/hooks"
import { toQuotationData } from "@/features/quotations/adapters"
import { useQuotation } from "@/features/quotations/hooks"
import QuotationDetail from "@/features/quotations/QuotationDetail"
import { useUnits } from "@/features/units/hooks"
import { isMissing } from "@/lib/errors"

type QuotationSearch = {
  // Open the Ganti Narahubung picker
  narahubung?: true
}

// Deep link from PO gate.
//
// ?narahubung=true opens Ganti Narahubung.
export const Route = createFileRoute("/_authed/quotations/$id/")({
  validateSearch: (search: Record<string, unknown>): QuotationSearch =>
    search.narahubung === true || search.narahubung === "true" ? { narahubung: true } : {},
  component: QuotationDetailRoute,
})

function QuotationDetailRoute() {
  const { id } = Route.useParams()
  const { narahubung } = Route.useSearch()
  const navigate = useNavigate()

  const numericId = Number(id)
  const hasNumericId = Number.isInteger(numericId) && numericId > 0
  const {
    data: detail,
    isPending,
    error,
    refetch,
  } = useQuotation(hasNumericId ? numericId : undefined)
  const { data: units } = useUnits()
  const { data: client } = useClient(detail?.companyClientId)
  const { data: contacts } = useClientContacts(detail?.companyClientId)

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

  if (hasNumericId && isPending) return <LoadingState label="Memuat quotation…" />
  if (error && !isMissing(error)) {
    return <RouteErrorFallback error={error} reset={() => void refetch()} />
  }
  if (!detail || !quotation) {
    return (
      <NotFoundState
        title="Quotation tidak ditemukan"
        backTo={{ to: "/quotations", label: "Kembali ke Daftar Quotation" }}
      />
    )
  }

  return (
    <QuotationDetail
      key={detail.id}
      quotationNo={detail.quotationNo}
      quotation={quotation}
      transitions={detail.allowedTransitions ?? []}
      canRevise={detail.canRevise === true}
      contactId={detail.contactId}
      openContactPicker={narahubung === true}
      onEdit={() => void navigate({ to: "/quotations/$id/edit", params: { id } })}
    />
  )
}
