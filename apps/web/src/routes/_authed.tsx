import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import Sidebar from "@/components/shared/Sidebar"
import * as authApi from "@/features/auth/api"
import { clearAuthState, isAuthenticatedSync } from "@/features/auth/hooks"
import { queryKeys } from "@/lib/query-keys"
import { roleCanAccess, sectionFromPathname } from "@/lib/rbac"

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location }) => {
    if (!isAuthenticatedSync()) throw redirect({ to: "/login" })
    let me: Awaited<ReturnType<typeof authApi.me>>
    try {
      me = await context.queryClient.fetchQuery({
        queryKey: queryKeys.auth.me(),
        queryFn: authApi.me,
        staleTime: 5 * 60 * 1000,
      })
    } catch {
      clearAuthState()
      throw redirect({ to: "/login" })
    }
    // Typed URLs respect the role matrix.
    if (!roleCanAccess(me.role, sectionFromPathname(location.pathname))) {
      throw redirect({ to: "/" })
    }
  },
  component: AuthedLayout,
  // Errors render inside the shell.
  errorComponent: ({ error, reset }) => (
    <AppShell>
      <RouteErrorFallback error={error} reset={reset} />
    </AppShell>
  ),
})

// Sidebar plus scrolling main.
function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-dark-50">
      <Sidebar />
      <main className="ml-[220px] flex h-dvh min-w-0 flex-1 flex-col overflow-y-auto max-lg:ml-0 max-lg:pt-14">
        {children}
      </main>
    </div>
  )
}

// App shell for every authenticated route.
function AuthedLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
