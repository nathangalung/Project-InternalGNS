import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { validateVendorSearch } from "@/features/vendors/list-search"
import VendorList from "@/features/vendors/VendorList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/vendors/")({
  validateSearch: validateVendorSearch,
  component: VendorListRoute,
})

function VendorListRoute() {
  const navigate = useNavigate()
  const state = useTrailState()

  return (
    <VendorList
      onViewDetail={(id) =>
        void navigate({ to: "/vendors/$id", params: { id: String(id) }, state })
      }
    />
  )
}
