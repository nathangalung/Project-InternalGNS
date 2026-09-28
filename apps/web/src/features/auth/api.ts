import { apiRequest } from "@/lib/api-client"
import type { ChangeOwnPasswordInput, LoginInput, LoginResponse, MeUser } from "@/types/api"

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>({
    path: "/auth/login",
    method: "POST",
    body: { email, password } satisfies LoginInput,
    // A 401 here means wrong credentials, not an expired session
    authed: false,
  })
}

export async function me(): Promise<MeUser> {
  return apiRequest<MeUser>({ path: "/auth/me" })
}

// Self-service password change.
//
// Any role; a 204 ends every session.
export async function changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void> {
  await apiRequest<void>({
    path: "/auth/me/password",
    method: "PATCH",
    body: input,
  })
}
