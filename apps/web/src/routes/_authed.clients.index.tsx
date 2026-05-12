import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import ClientList from "@/features/clients/ClientList"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/clients/")({
  component: ClientListRoute,
})

function ClientListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <ClientList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(id) => void navigate({ to: "/clients/$id", params: { id: String(id) } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
