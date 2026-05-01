import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import VendorDetail from "@/features/vendors/VendorDetail"
import { useAuth } from "@/features/auth/hooks"
import { useVendor } from "@/features/vendors/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/vendors/$id/")({
  component: VendorDetailRoute,
})

function VendorDetailRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { id } = useParams({ from: "/_authed/vendors/$id/" })
  const numericId = Number(id)
  const { data, isLoading } = useVendor(numericId)

  if (!data) {
    return (
      <div style={{ padding: "48px", fontFamily: "'Inter', sans-serif", color: "#64748B" }}>
        {isLoading ? "Memuat data vendor…" : "Vendor tidak ditemukan."}
      </div>
    )
  }

  return (
    <VendorDetail
      vendor={data}
      onNavigate={makePageNavigate(navigate)}
      onBack={() => void navigate({ to: "/vendors" })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
