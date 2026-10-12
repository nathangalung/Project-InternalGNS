import { createFileRoute, useNavigate } from "@tanstack/react-router"
import ProductList from "@/features/items/ProductList"
import { useTrailState } from "@/hooks/useNavTrail"

export const Route = createFileRoute("/_authed/products/")({
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
