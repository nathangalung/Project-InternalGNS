import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import RouteNotFound from "@/components/shared/RouteNotFound"
import ToastViewport from "@/components/shared/ToastViewport"

type RouterContext = { queryClient: QueryClient }

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )

const ReactQueryDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RouteNotFound,
  errorComponent: ({ error, reset }) => <RouteErrorFallback error={error} reset={reset} />,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      <ToastViewport />
      <Suspense fallback={null}>
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      </Suspense>
    </>
  )
}
