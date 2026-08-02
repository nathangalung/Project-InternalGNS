import { createFileRoute } from "@tanstack/react-router"
import QuotationEdit from "@/features/quotations/QuotationEdit"

export const Route = createFileRoute("/_authed/quotations/$id/edit")({
  component: QuotationEditRoute,
})

function QuotationEditRoute() {
  const { id } = Route.useParams()

  // Keyed so switching quotations remounts the wizard with fresh state, while a
  // background refetch of the same quotation keeps entered steps.
  return <QuotationEdit key={id} quotationId={id} />
}
