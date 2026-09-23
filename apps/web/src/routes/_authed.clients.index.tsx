import { createFileRoute } from "@tanstack/react-router"
import ClientList from "@/features/clients/ClientList"

export const Route = createFileRoute("/_authed/clients/")({
  component: ClientList,
})
