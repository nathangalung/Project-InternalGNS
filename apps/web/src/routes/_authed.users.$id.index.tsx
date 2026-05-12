import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import { useUser } from "@/features/users/hooks"
import UserDetail from "@/features/users/UserDetail"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/users/$id/")({
  component: UserDetailRoute,
})

function UserDetailRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { id } = useParams({ from: "/_authed/users/$id/" })
  const numericId = Number(id)
  const { data, isLoading } = useUser(numericId)

  if (!data) {
    return (
      <div style={{ padding: "48px", fontFamily: "'Inter', sans-serif", color: "#64748B" }}>
        {isLoading ? "Memuat data pengguna…" : "Pengguna tidak ditemukan."}
      </div>
    )
  }

  return (
    <UserDetail
      user={data}
      isLoading={isLoading}
      onNavigate={makePageNavigate(navigate)}
      onBack={() => void navigate({ to: "/users" })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
