import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationList from "@/features/quotations/QuotationList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/quotations/")({
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
