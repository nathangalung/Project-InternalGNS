import type { useNavigate } from "@tanstack/react-router"
import type { Page } from "@/lib/page"

type Navigate = ReturnType<typeof useNavigate>

export function makePageNavigate(navigate: Navigate, currentId?: string): (page: Page) => void {
  return (page) => {
    switch (page) {
      case "dashboard":
        void navigate({ to: "/" })
        return
      case "dashboard-financial":
        void navigate({ to: "/dashboard-financial" })
        return
      case "dashboard-operational":
        void navigate({ to: "/dashboard-operational" })
        return
      case "quotation":
        void navigate({ to: "/quotations" })
        return
      case "quotation-detail":
        if (currentId) void navigate({ to: "/quotations/$id", params: { id: currentId } })
        return
      case "quotation-edit":
        if (currentId) void navigate({ to: "/quotations/$id/edit", params: { id: currentId } })
        return
      case "quotation-add":
        void navigate({ to: "/quotations/add" })
        return
      case "purchase-orders":
        void navigate({ to: "/purchase-orders" })
        return
      case "purchase-order-detail":
        if (currentId) void navigate({ to: "/purchase-orders/$id", params: { id: currentId } })
        return
      case "purchase-order-edit":
        if (currentId) void navigate({ to: "/purchase-orders/$id/edit", params: { id: currentId } })
        return
      case "invoices":
        void navigate({ to: "/invoices" })
        return
      case "invoice-detail":
        if (currentId) void navigate({ to: "/invoices/$id", params: { id: currentId } })
        return
      case "users":
        void navigate({ to: "/users" })
        return
      case "clients":
        void navigate({ to: "/clients" })
        return
      case "vendors":
        void navigate({ to: "/vendors" })
        return
      case "products":
        void navigate({ to: "/products" })
        return
    }
  }
}
