import { createFileRoute, useNavigate } from "@tanstack/react-router"
import UserList from "@/features/users/UserList"
import { useAuth } from "@/features/auth/hooks"
import { useUsers } from "@/features/users/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/users/")({
  component: UserListRoute,
})

function UserListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { data, isLoading } = useUsers({ limit: 200 })

  return (
    <UserList
      onNavigate={makePageNavigate(navigate)}
      rows={data}
      isLoading={isLoading}
      onViewDetail={(id) => void navigate({ to: "/users/$id", params: { id: String(id) } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
