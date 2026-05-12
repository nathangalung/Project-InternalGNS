import { apiRequest } from "@/lib/api-client"
import type { LoginResponse } from "@/types/api"

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>({
    path: "/auth/login",
    method: "POST",
    body: { email, password },
  })
}
