import { createFileRoute } from "@tanstack/react-router"
import UserList from "@/features/users/UserList"

export const Route = createFileRoute("/_authed/users/")({
  component: UserList,
})
