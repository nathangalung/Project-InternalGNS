import { createFileRoute } from "@tanstack/react-router"
import QuotationEdit from "@/features/quotations/QuotationEdit"
import { compact, positiveInt } from "@/lib/list-search"

// Step and line to open
type EditSearch = { step?: number; line?: number }

export const Route = createFileRoute("/_authed/quotations/$id/edit")({
  validateSearch: (search: Record<string, unknown>): EditSearch =>
    compact({
      step: positiveInt(search.step, 4),
      line: positiveInt(search.line, Number.MAX_SAFE_INTEGER),
    }),
  component: QuotationEditRoute,
})

function QuotationEditRoute() {
  const { id } = Route.useParams()
  const { step, line } = Route.useSearch()

  // Keyed so switching quotations remounts the wizard with fresh state, while a
  // background refetch of the same quotation keeps entered steps.
  return <QuotationEdit key={id} quotationId={id} startStep={step} startLine={line} />
}
