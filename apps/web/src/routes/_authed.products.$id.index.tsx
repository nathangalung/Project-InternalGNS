import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router"
import { useAuth } from "@/features/auth/hooks"
import { useItem } from "@/features/items/hooks"
import ProductDetail from "@/features/items/ProductDetail"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/products/$id/")({
  component: ProductDetailRoute,
})

function ProductDetailRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { id } = useParams({ from: "/_authed/products/$id/" })
  const numericId = Number(id)
  const { data, isLoading } = useItem(numericId)

  if (!data) {
    return (
      <div style={{ padding: "48px", fontFamily: "'Inter', sans-serif", color: "#64748B" }}>
        {isLoading ? "Memuat data produk…" : "Produk tidak ditemukan."}
      </div>
    )
  }

  // Keyed so a different product remounts with fresh form state, while a
  // background refetch of the same product keeps in-progress edits.
  return (
    <ProductDetail
      key={data.id}
      product={data}
      onNavigate={makePageNavigate(navigate)}
      onBack={() => void navigate({ to: "/products" })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
