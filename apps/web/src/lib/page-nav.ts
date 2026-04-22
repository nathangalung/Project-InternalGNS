import type { useNavigate } from "@tanstack/react-router"
import type { Page } from "@/main"

type Navigate = ReturnType<typeof useNavigate>

export function makePageNavigate(navigate: Navigate, currentId?: string): (page: Page) => void {
  return (page) => {
    switch (page) {
      case "dashboard":
        void navigate({ to: "/" })
        return
      case "quotation":
        void navigate({ to: "/quotations" })
        return
      case "quotation-detail":
        if (currentId) void navigate({ to: "/quotations/$id", params: { id: currentId } })
        return
      case "quotation-edit":
        if (currentId) void navigate({ to: "/quotations/$id/edit", params: { id: currentId } })
      case "quotation-add":
        void navigate({ to: "/quotations/add" }) // Sesuaikan string "/quotations/add" dengan path di routes Anda
        return
    }
  }
}