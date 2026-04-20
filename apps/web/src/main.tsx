import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { queryClient } from "@/lib/query-client"
import { routeTree } from "./routeTree.gen"
import "./styles/tailwind.css"
import "./styles/design-tokens.css"
import "./styles/admin.css"

// Friend's 4-state page machine — 5 components depend on this type
// via `import type { Page } from "../../main"`. Keep the export stable.
export type Page = "dashboard" | "quotation" | "quotation-detail" | "quotation-edit"

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { queryClient },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
