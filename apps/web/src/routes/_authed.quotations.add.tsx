import { createFileRoute, useNavigate } from "@tanstack/react-router"
import QuotationAdd from "@/components/quotation/QuotationAdd"
import { useAuth } from "@/hooks/use-auth"
import { makePageNavigate } from "@/lib/page-nav"

// Perhatikan path-nya tidak ada $id
export const Route = createFileRoute("/_authed/quotations/add")({
  component: QuotationAddRoute,
})

function QuotationAddRoute() {
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <QuotationAdd
      // Tidak perlu melempar id ke makePageNavigate
      onNavigate={makePageNavigate(navigate)} 
      onLogout={() => {
        logout()
        void navigate({ to: "/login" })
      }}
    />
  )
}