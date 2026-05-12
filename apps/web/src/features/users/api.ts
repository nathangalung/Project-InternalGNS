import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
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

function buildQuery(params: ListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.role) search.set("role", params.role)
  if (params.isActive !== undefined) search.set("isActive", String(params.isActive))
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  return search.toString()
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

export async function update(id: number, input: UpdateUserInput): Promise<UserRow> {
  const { password, ...rest } = input
  const updated = await apiRequest<UserRow>({
    path: `/users/${id}`,
    method: "PUT",
    body: rest,
  })
  if (password) {
    await apiRequest<void>({
      path: `/users/${id}/password`,
      method: "PATCH",
      body: { password },
    })
  }
  return updated
}
