import { createFileRoute, useNavigate } from "@tanstack/react-router"
import VendorList from "@/features/vendors/VendorList"

export const Route = createFileRoute("/_authed/vendors/")({
  component: VendorListRoute,
})

function VendorListRoute() {
  const navigate = useNavigate()

  return (
    <VendorList
      onViewDetail={(id) => void navigate({ to: "/vendors/$id", params: { id: String(id) } })}
    />
  )
}
