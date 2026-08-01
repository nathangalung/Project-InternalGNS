import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import ClientDetail from "@/features/clients/ClientDetail"
import { useClient } from "@/features/clients/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/clients/$id/")({
  component: ClientDetailRoute,
})

function ClientDetailRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { id } = useParams({ from: "/_authed/clients/$id/" })
  const numericId = Number(id)
  const { data, isLoading } = useClient(numericId)

  if (!data) {
    return (
      <div style={{ padding: "48px", fontFamily: "'Inter', sans-serif", color: "#64748B" }}>
        {isLoading ? "Memuat data klien…" : "Klien tidak ditemukan."}
      </div>
    )
  }

  // Keyed so a different client remounts with fresh form state, while a
  // background refetch of the same client keeps in-progress edits.
  return (
    <ClientDetail
      key={data.id}
      client={data}
      onNavigate={makePageNavigate(navigate)}
      onBack={() => void navigate({ to: "/clients" })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
