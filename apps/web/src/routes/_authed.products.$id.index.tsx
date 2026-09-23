import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import { useItem } from "@/features/items/hooks"
import ProductDetail from "@/features/items/ProductDetail"
import { isMissing } from "@/lib/errors"

export const Route = createFileRoute("/_authed/products/$id/")({
  component: ProductDetailRoute,
})

function ProductDetailRoute() {
  const navigate = useNavigate()
  const { id } = useParams({ from: "/_authed/products/$id/" })
  const numericId = Number(id)
  const { data, isLoading, error, refetch } = useItem(numericId)

  if (!data) {
    if (isLoading) return <LoadingState label="Memuat data produk…" />
    if (error && !isMissing(error)) {
      return <RouteErrorFallback error={error} reset={() => void refetch()} />
    }
    return (
      <NotFoundState
        title="Produk tidak ditemukan"
        size="page"
        backTo={{ to: "/products", label: "Kembali ke Katalog Produk" }}
      />
    )
  }

  // Keyed so a different product remounts with fresh form state, while a
  // background refetch of the same product keeps in-progress edits.
  return (
    <ProductDetail key={data.id} product={data} onBack={() => void navigate({ to: "/products" })} />
  )
}
