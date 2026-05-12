import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo } from "react"
import { useAuth } from "@/features/auth/hooks"
import InvoiceDetail from "@/features/invoices/InvoiceDetail"
import { toQuotationData } from "@/features/quotations/adapters"
import { useQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/invoices/$id/")({
  component: InvoiceDetailRoute,
})

function InvoiceDetailRoute() {
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
    return (unitId?: number) => (unitId !== undefined ? (map.get(unitId) ?? "") : "")
  }, [units])

  const quotation = detail ? toQuotationData(detail, unitOf) : undefined

  return (
    <InvoiceDetail
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
