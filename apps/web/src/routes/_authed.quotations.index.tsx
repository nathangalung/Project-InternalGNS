import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { validateQuotationSearch } from "@/features/quotations/list-search"
import QuotationList from "@/features/quotations/QuotationList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/quotations/")({
  validateSearch: validateQuotationSearch,
  component: QuotationListRoute,
})

function QuotationListRoute() {
  const navigate = useNavigate()
  const state = useTrailState()

  return (
    <QuotationList
      onViewDetail={(id) => void navigate({ to: "/quotations/$id", params: { id }, state })}
    />
  )
}
