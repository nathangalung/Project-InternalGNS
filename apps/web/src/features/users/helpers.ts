import type { Role } from "@/types/api"

type Access = { role: Role; isActive: boolean }

// Edits that end sessions.
//
// Mirrors users.Repo.Update and UpdatePassword on the API: a role change, a
// deactivation or a new password revokes every session. A rename, an email
// change or a reactivation keeps them.
export function endsSessions(before: Access, after: Access & { password?: string }): boolean {
  return (
    before.role !== after.role ||
    (before.isActive && !after.isActive) ||
    (after.password ?? "").length > 0
  )
}

// Role names in the UI.
export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  operational: "Operasional",
  finance: "Finance",
}

// Order the role pickers list them.
export const ROLE_ORDER: readonly Role[] = ["superadmin", "finance", "operational"]
