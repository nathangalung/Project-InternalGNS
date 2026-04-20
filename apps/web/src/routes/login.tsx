import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import LoginPage from "@/components/auth/LoginPage"
import { isAuthenticatedSync, useAuth } from "@/hooks/use-auth"

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    if (isAuthenticatedSync()) throw redirect({ to: "/" })
  },
  component: LoginRoute,
})

function LoginRoute() {
  const navigate = useNavigate()
  const { login } = useAuth()

  return (
    <LoginPage
      onLogin={() => {
        login()
        void navigate({ to: "/" })
      }}
    />
  )
}
