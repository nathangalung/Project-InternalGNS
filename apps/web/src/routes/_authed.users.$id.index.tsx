import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
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
    if (isLoading) return <LoadingState label="Memuat data pengguna…" />
    return (
      <NotFoundState
        title="Pengguna tidak ditemukan"
        size="page"
        backTo={{ to: "/users", label: "Kembali ke Daftar Pengguna" }}
      />
    )
  }

  // Keyed so another user remounts fresh.
  return <UserDetail key={data.id} user={data} onBack={() => void navigate({ to: "/users" })} />
}
