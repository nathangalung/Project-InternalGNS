import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import UserList from "@/features/users/UserList"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/users/")({
  component: UserListRoute,
})

function UserListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <UserList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(id) => void navigate({ to: "/users/$id", params: { id: String(id) } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
