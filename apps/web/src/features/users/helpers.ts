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
  operational: "Kepala Operasional",
  operational_input: "Input Data Operasional",
  finance: "Kepala Keuangan",
  finance_input: "Input Data Keuangan",
}

// What each role may do.
export const ROLE_HINT: Record<Role, string> = {
  superadmin: "Semua akses, termasuk kelola pengguna.",
  operational: "Quotation, PO, katalog, harga beli dan harga jual.",
  operational_input:
    "Data klien, permintaan klien, harga beli dan katalog. Tidak melihat harga jual atau profit.",
  finance: "Invoice dan dashboard keuangan. Data operasional hanya dibaca.",
  finance_input: "Invoice, pembayaran, NPWP dan TKU klien. Tidak melihat harga beli atau profit.",
}

// Order the role pickers list them.
export const ROLE_ORDER: readonly Role[] = [
  "superadmin",
  "operational",
  "operational_input",
  "finance",
  "finance_input",
]
