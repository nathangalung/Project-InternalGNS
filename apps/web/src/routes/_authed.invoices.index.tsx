import { createFileRoute, useNavigate } from "@tanstack/react-router"
import InvoiceList from "@/features/invoices/InvoiceList"

export const Route = createFileRoute("/_authed/invoices/")({
  component: InvoiceListRoute,
})

function InvoiceListRoute() {
  const navigate = useNavigate()

  return (
    <InvoiceList
      onViewDetail={(qid) => void navigate({ to: "/invoices/$id", params: { id: String(qid) } })}
    />
  )
}
