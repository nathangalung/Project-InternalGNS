import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import { toQuotationData } from "@/features/quotations/adapters"
import { useChangeQuotationStatus, useQuotation } from "@/features/quotations/hooks"
import QuotationDetail from "@/features/quotations/QuotationDetail"
import type { Status } from "@/features/quotations/types"
import { useUnits } from "@/features/units/hooks"
import { labelToStatus } from "@/lib/status"

export const Route = createFileRoute("/_authed/quotations/$id/")({
  component: QuotationDetailRoute,
})

function QuotationDetailRoute() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const numericId = Number(id)
  const hasNumericId = Number.isFinite(numericId) && numericId > 0
  const { data: detail } = useQuotation(hasNumericId ? numericId : undefined)
  const { data: units } = useUnits()
  const changeStatus = useChangeQuotationStatus()

  const unitOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const u of units ?? []) map.set(u.id, u.code)
    return (unitId?: number) => (unitId !== undefined ? (map.get(unitId) ?? "") : "")
  }, [units])

  const quotation = detail ? toQuotationData(detail, unitOf) : undefined

  function handleSaveStatus(next: Status) {
    if (!detail) return
    changeStatus.mutate({ id: detail.id, status: labelToStatus(next) })
  }

  return (
    <QuotationDetail
      quotationId={detail?.quotationNo ?? id}
      quotation={quotation}
      onSaveStatus={detail ? handleSaveStatus : undefined}
      onEdit={() => void navigate({ to: "/quotations/$id/edit", params: { id } })}
    />
  )
}
