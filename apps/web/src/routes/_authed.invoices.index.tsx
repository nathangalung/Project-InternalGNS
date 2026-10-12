import { createFileRoute, useNavigate } from "@tanstack/react-router"
import InvoiceList from "@/features/invoices/InvoiceList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/invoices/")({
  component: InvoiceListRoute,
})

function InvoiceListRoute() {
  const navigate = useNavigate()
  const state = useTrailState()

  return (
    <InvoiceList
      onViewDetail={(qid, search) =>
        void navigate({ to: "/invoices/$id", params: { id: String(qid) }, search, state })
      }
    />
  )
}
