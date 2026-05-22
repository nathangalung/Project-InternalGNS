import { apiRequest, getRefreshToken } from "@/lib/api-client"
import type { LoginResponse, MeUser } from "@/types/api"

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>({
    path: "/auth/login",
    method: "POST",
    body: { email, password },
  })
}

export async function me(): Promise<MeUser> {
  return apiRequest<MeUser>({ path: "/auth/me" })
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()
  await apiRequest<void>({
    path: "/auth/logout",
    method: "POST",
    body: refreshToken ? { refreshToken } : undefined,
  })
}
