import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { queryClient } from "@/lib/query-client"
import { routeTree } from "./routeTree.gen"
import "./styles/tailwind.css"
import "./styles/design-tokens.css"
import "./styles/admin.css"

// Page state for nav.
export type Page =
  | "dashboard"
  | "quotation"
  | "quotation-detail"
  | "quotation-edit"
  | "quotation-add"

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
