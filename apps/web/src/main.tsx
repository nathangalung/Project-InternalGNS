import { CSPProvider } from "@base-ui/react/csp-provider"
import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { MAIN_SCROLL_SELECTOR } from "@/lib/nav-trail"
import { queryClient } from "@/lib/query-client"
import { startSession } from "@/lib/session"
import { routeTree } from "./routeTree.gen"
// Self-hosted Inter font.
//
// No render-blocking external font request.
import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "@fontsource/inter/700.css"
import "./styles/tailwind.css"

// Before the first route restores.
startSession()

// Scroll restoration for <main>.
//
// The shell scrolls <main>, not the window. The router keeps its scroll per
// history entry: a back or a crumb back to an entry restores it, and a new
// navigation starts <main> at the top.
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { queryClient },
  scrollRestoration: true,
  scrollToTopSelectors: [MAIN_SCROLL_SELECTOR],
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// No inline Base UI styles.
//
// The enforced style-src 'self' refuses a <style> element; the one rule
// Base UI would inject lives in tailwind.css instead.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CSPProvider>
  </StrictMode>,
)
