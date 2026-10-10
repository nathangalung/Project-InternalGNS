import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"
import type {
  ChangeUserPasswordInput,
  CreateUserInput,
  Role,
  UpdateUserInput as UserProfileInput,
  UserRow,
} from "@/types/api"

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

export async function create(input: CreateUserInput): Promise<UserRow> {
  return apiRequest<UserRow>({
    path: "/users",
    method: "POST",
    body: input,
  })
}

// Profile plus optional password.
//
// The password goes to its own PATCH after the PUT.
export type UpdateUserInput = UserProfileInput & { password?: string }

// Profile saved, password PATCH failed.
export class PartialUserUpdateError extends Error {
  readonly profileSaved = true
  constructor(readonly passwordError: unknown) {
    super(errorMessage(passwordError, "Kata sandi gagal diperbarui"))
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
        body: { password } satisfies ChangeUserPasswordInput,
      })
    } catch (err) {
      throw new PartialUserUpdateError(err)
    }
  }
  return updated
}
