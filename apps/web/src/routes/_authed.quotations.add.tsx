import { createFileRoute } from "@tanstack/react-router"
import QuotationAdd from "@/features/quotations/QuotationAdd"

// Path has no $id.
export const Route = createFileRoute("/_authed/quotations/add")({
  component: QuotationAddRoute,
})

function QuotationAddRoute() {
  return <QuotationAdd />
}
