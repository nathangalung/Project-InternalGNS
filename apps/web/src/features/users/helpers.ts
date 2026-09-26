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
