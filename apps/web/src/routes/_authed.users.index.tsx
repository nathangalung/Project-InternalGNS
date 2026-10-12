import { createFileRoute } from "@tanstack/react-router"
import { validateUserSearch } from "@/features/users/list-search"
import UserList from "@/features/users/UserList"

export const Route = createFileRoute("/_authed/users/")({
  validateSearch: validateUserSearch,
  component: UserList,
})
