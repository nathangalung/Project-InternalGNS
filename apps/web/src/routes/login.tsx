import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import * as auth from "@/features/auth/api"
import { useAuth } from "@/features/auth/hooks"
import Login from "@/features/auth/Login"
import { restoreSession } from "@/lib/session"

export const Route = createFileRoute("/login")({
  // A live refresh cookie skips the form.
  beforeLoad: async () => {
    if (await restoreSession()) throw redirect({ to: "/" })
  },
  component: LoginRoute,
})

function LoginRoute() {
  const navigate = useNavigate()
  const { login } = useAuth()

  return (
    <Login
      onLogin={async (email, password) => {
        const resp = await auth.login(email, password)
        login(resp.token)
        void navigate({ to: "/" })
      }}
    />
  )
}
