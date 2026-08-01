import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationList from "@/features/quotations/QuotationList"

export const Route = createFileRoute("/_authed/quotations/")({
  component: QuotationListRoute,
})

function QuotationListRoute() {
  const navigate = useNavigate()

  return (
    <QuotationList
      onViewDetail={(id) => void navigate({ to: "/quotations/$id", params: { id } })}
    />
  )
}
