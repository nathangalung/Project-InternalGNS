import { createFileRoute, useNavigate } from "@tanstack/react-router"
import ProductList from "@/features/items/ProductList"
import { useAuth } from "@/features/auth/hooks"
import { makePageNavigate } from "@/lib/page-nav"

export const Route = createFileRoute("/_authed/products/")({
  component: ProductListRoute,
})

function ProductListRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <ProductList
      onNavigate={makePageNavigate(navigate)}
      onViewDetail={(id) => void navigate({ to: "/products/$id", params: { id: String(id) } })}
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}
