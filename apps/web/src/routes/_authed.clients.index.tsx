import { createFileRoute } from "@tanstack/react-router"
import ClientList from "@/features/clients/ClientList"
import { validateClientSearch } from "@/features/clients/list-search"

export const Route = createFileRoute("/_authed/clients/")({
  validateSearch: validateClientSearch,
  component: ClientList,
})
