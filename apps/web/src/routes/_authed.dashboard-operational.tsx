import { createFileRoute, useNavigate } from "@tanstack/react-router"
import DashboardOperational from "@/features/dashboard/DashboardOperational"

export const Route = createFileRoute("/_authed/dashboard-operational")({
  component: DashboardOperationalRoute,
})

function DashboardOperationalRoute() {
  const navigate = useNavigate()

  return (
    <DashboardOperational
      onViewQuotation={(qid) =>
        void navigate({ to: "/quotations/$id", params: { id: String(qid) } })
      }
      onViewAllQuotations={() => void navigate({ to: "/quotations" })}
    />
  )
}
