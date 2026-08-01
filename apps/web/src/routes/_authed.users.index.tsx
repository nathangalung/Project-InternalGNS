import { createFileRoute, useNavigate } from "@tanstack/react-router"
import UserList from "@/features/users/UserList"

export const Route = createFileRoute("/_authed/users/")({
  component: UserListRoute,
})

function UserListRoute() {
  const navigate = useNavigate()

  return (
    <UserList
      onViewDetail={(id) => void navigate({ to: "/users/$id", params: { id: String(id) } })}
    />
  )
}
