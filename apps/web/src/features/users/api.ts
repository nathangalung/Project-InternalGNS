import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type { Role, UserRow } from "@/types/api"

export type ListParams = {
  q?: string
  role?: Role
  isActive?: boolean
  sortBy?: "name" | "createdAt"
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

export async function list(params: ListParams = {}): Promise<PaginatedList<UserRow>> {
  const qs = buildQuery(params)
  return apiList<UserRow>({ path: `/users${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<UserRow> {
  return apiRequest<UserRow>({ path: `/users/${id}` })
}

export type CreateUserInput = {
  name: string
  email: string
  password: string
  role: Role
  isActive?: boolean
}

export async function create(input: CreateUserInput): Promise<UserRow> {
  return apiRequest<UserRow>({
    path: "/users",
    method: "POST",
    body: input,
  })
}

export type UpdateUserInput = {
  name: string
  email: string
  role: Role
  isActive: boolean
  password?: string
}

// Profile saved but the password PATCH failed.
export class PartialUserUpdateError extends Error {
  readonly profileSaved = true
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Kata sandi gagal diperbarui")
    this.name = "PartialUserUpdateError"
  }
}

export async function update(id: number, input: UpdateUserInput): Promise<UserRow> {
  const { password, ...rest } = input
  const updated = await apiRequest<UserRow>({
    path: `/users/${id}`,
    method: "PUT",
    body: rest,
  })
  if (password) {
    try {
      await apiRequest<void>({
        path: `/users/${id}/password`,
        method: "PATCH",
        body: { password },
      })
    } catch (err) {
      throw new PartialUserUpdateError(err)
    }
  }
  return updated
}
