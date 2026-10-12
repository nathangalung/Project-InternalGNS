import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { validateProductSearch } from "@/features/items/list-search"
import ProductList from "@/features/items/ProductList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/products/")({
  validateSearch: validateProductSearch,
  component: ProductListRoute,
})

function ProductListRoute() {
  const navigate = useNavigate()
  const state = useTrailState()

  return (
    <ProductList
      onViewDetail={(id) =>
        void navigate({ to: "/products/$id", params: { id: String(id) }, state })
      }
    />
  )
}
