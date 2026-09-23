import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useItem } from "@/features/items/hooks"
import ProductDetail from "@/features/items/ProductDetail"
import { routeFallbackCls } from "./-fallback"

export const Route = createFileRoute("/_authed/products/$id/")({
  component: ProductDetailRoute,
})

function ProductDetailRoute() {
  const navigate = useNavigate()
  const { id } = useParams({ from: "/_authed/products/$id/" })
  const numericId = Number(id)
  const { data, isLoading } = useItem(numericId)

  if (!data) {
    return (
      <div className={routeFallbackCls}>
        {isLoading ? "Memuat data produk…" : "Produk tidak ditemukan."}
      </div>
    )
  }

  // Keyed so a different product remounts with fresh form state, while a
  // background refetch of the same product keeps in-progress edits.
  return (
    <ProductDetail key={data.id} product={data} onBack={() => void navigate({ to: "/products" })} />
  )
}
