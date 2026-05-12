import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import VendorList from "@/features/vendors/VendorList"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/vendors/")({
  component: VendorListRoute,
})

function VendorListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <VendorList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(id) => void navigate({ to: "/vendors/$id", params: { id: String(id) } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
