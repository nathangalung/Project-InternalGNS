import { createFileRoute, useNavigate } from "@tanstack/react-router"
import ClientList from "@/features/clients/ClientList"

export const Route = createFileRoute("/_authed/clients/")({
  component: ClientListRoute,
})

function ClientListRoute() {
  const navigate = useNavigate()

  return (
    <ClientList
      onViewDetail={(id) => void navigate({ to: "/clients/$id", params: { id: String(id) } })}
    />
  )
}
