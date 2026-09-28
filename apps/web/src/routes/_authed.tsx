import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useEffect } from "react"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import Sidebar from "@/components/shared/Sidebar"
import * as authApi from "@/features/auth/api"
import { clearAuthState, useAuth } from "@/features/auth/hooks"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { roleCanAccess, sectionFromPathname } from "@/lib/rbac"
import { restoreSession } from "@/lib/session"

export const Route = createFileRoute("/_authed")({
  // A page load restores from the refresh cookie.
  beforeLoad: async ({ context, location }) => {
    if (!(await restoreSession())) throw redirect({ to: "/login" })
    let me: Awaited<ReturnType<typeof authApi.me>>
    try {
      me = await context.queryClient.fetchQuery({
        queryKey: queryKeys.auth.me(),
        queryFn: authApi.me,
        staleTime: 5 * 60 * 1000,
      })
    } catch (err) {
      // Only a 401 ends the session; other failures render the error.
      if (!(err instanceof ApiError && err.status === 401)) throw err
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

// Shell for authenticated routes.
//
// A session that ends while the shell is open (logout in another tab, a
// refused refresh) leaves for the login page at once, rendering nothing.
function AuthedLayout() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isAuthenticated) void navigate({ to: "/login" })
  }, [isAuthenticated, navigate])
  if (!isAuthenticated) return null
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
