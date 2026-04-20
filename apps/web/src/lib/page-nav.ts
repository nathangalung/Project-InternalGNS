import type { useNavigate } from "@tanstack/react-router"
import type { Page } from "@/main"

type Navigate = ReturnType<typeof useNavigate>

/**
 * Translates friend's `onNavigate(page: Page)` prop contract into
 * TanStack Router navigate() calls. Pass `currentId` when the caller
 * lives on a detail/edit route, so breadcrumb links like
 * `onNavigate("quotation-detail")` can resolve the dynamic segment.
 */
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
        return
    }
  }
}
