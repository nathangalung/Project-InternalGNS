import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { useVendor } from "@/features/vendors/hooks"
import VendorDetail from "@/features/vendors/VendorDetail"
import { isMissing } from "@/lib/errors"

export const Route = createFileRoute("/_authed/vendors/$id/")({
  component: VendorDetailRoute,
})

function VendorDetailRoute() {
  const navigate = useNavigate()
  const { id } = useParams({ from: "/_authed/vendors/$id/" })
  const numericId = Number(id)
  const { data, isLoading, error, refetch } = useVendor(numericId)

  if (!data) {
    if (isLoading) return <LoadingState label="Memuat data vendor…" />
    // A bad or unknown id is missing; the rest can retry.
    if (error && !isMissing(error)) {
      return <RouteErrorFallback error={error} reset={() => void refetch()} />
    }
    return (
      <NotFoundState
        title="Vendor tidak ditemukan"
        size="page"
        backTo={{ to: "/vendors", label: "Kembali ke Daftar Vendor" }}
      />
    )
  }

  // Keyed so a different vendor remounts with fresh form state, while a
  // background refetch of the same vendor keeps in-progress edits.
  return (
    <VendorDetail key={data.id} vendor={data} onBack={() => void navigate({ to: "/vendors" })} />
  )
}
