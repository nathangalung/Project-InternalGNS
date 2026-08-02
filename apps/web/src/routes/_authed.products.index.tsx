import { createFileRoute, useNavigate } from "@tanstack/react-router"
import ProductList from "@/features/items/ProductList"

export const Route = createFileRoute("/_authed/products/")({
  component: ProductListRoute,
})

function ProductListRoute() {
  const navigate = useNavigate()

  return (
    <ProductList
      onViewDetail={(id) => void navigate({ to: "/products/$id", params: { id: String(id) } })}
    />
  )
}
