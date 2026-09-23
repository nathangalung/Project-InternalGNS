import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useVendor } from "@/features/vendors/hooks"
import VendorDetail from "@/features/vendors/VendorDetail"
import { routeFallbackCls } from "./-fallback"

export const Route = createFileRoute("/_authed/vendors/$id/")({
  component: VendorDetailRoute,
})

function VendorDetailRoute() {
  const navigate = useNavigate()
  const { id } = useParams({ from: "/_authed/vendors/$id/" })
  const numericId = Number(id)
  const { data, isLoading } = useVendor(numericId)

  if (!data) {
    return (
      <div className={routeFallbackCls}>
        {isLoading ? "Memuat data vendor…" : "Vendor tidak ditemukan."}
      </div>
    )
  }

  // Keyed so a different vendor remounts with fresh form state, while a
  // background refetch of the same vendor keeps in-progress edits.
  return (
    <VendorDetail key={data.id} vendor={data} onBack={() => void navigate({ to: "/vendors" })} />
  )
}
