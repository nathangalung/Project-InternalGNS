import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useUser } from "@/features/users/hooks"
import UserDetail from "@/features/users/UserDetail"

export const Route = createFileRoute("/_authed/users/$id/")({
  component: UserDetailRoute,
})

function UserDetailRoute() {
  const navigate = useNavigate()
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
    <UserDetail user={data} isLoading={isLoading} onBack={() => void navigate({ to: "/users" })} />
  )
}
