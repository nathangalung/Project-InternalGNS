// Backend has no /users endpoint, so this module reads/writes a localStorage
// store seeded with a few admins on first run. Function signatures stay the
// same as before, so hooks and pages don't need to change.
import type { Role, UserRow } from "@/types/api"

const STORAGE_KEY = "gns_users_local_v1"

interface UserStored extends UserRow {
  password?: string
}

const SEED: UserStored[] = [
  {
    id: 1,
    email: "bryan.p.hutagalung@gmail.com",
    name: "Bryan P. Hutagalung",
    role: "superadmin",
    isActive: true,
    createdAt: "2026-01-15T08:30:00Z",
    updatedAt: "2026-04-01T14:00:00Z",
  },
  {
    id: 2,
    email: "tamara.myrn@gmail.com",
    name: "Tamara Myrn",
    role: "operational",
    isActive: true,
    createdAt: "2026-02-10T09:00:00Z",
    updatedAt: "2026-03-12T11:00:00Z",
  },
  {
    id: 3,
    email: "siti.aminah@gns.co.id",
    name: "Siti Aminah",
    role: "finance",
    isActive: true,
    createdAt: "2026-02-20T10:00:00Z",
    updatedAt: "2026-04-05T08:30:00Z",
  },
  {
    id: 4,
    email: "andi.pratama@gns.co.id",
    name: "Andi Pratama",
    role: "operational",
    isActive: false,
    createdAt: "2026-01-25T07:00:00Z",
    updatedAt: "2026-03-30T15:00:00Z",
  },
]

function readAll(): UserStored[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED))
      return [...SEED]
    }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as UserStored[]
    return [...SEED]
  } catch {
    return [...SEED]
  }
}

function writeAll(rows: UserStored[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

function nextId(rows: UserStored[]): number {
  return rows.reduce((m, r) => (r.id > m ? r.id : m), 0) + 1
}

function strip(row: UserStored): UserRow {
  const { password: _password, ...rest } = row
  void _password
  return rest
}

export async function list(params: { limit?: number; offset?: number } = {}): Promise<UserRow[]> {
  const rows = readAll()
  const offset = params.offset ?? 0
  const limit = params.limit ?? rows.length
  return rows.slice(offset, offset + limit).map(strip)
}

export type CreateUserInput = {
  name: string
  email: string
  password: string
  role: Role
  isActive?: boolean
}

export async function create(input: CreateUserInput): Promise<UserRow> {
  const rows = readAll()
  if (rows.some(r => r.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error("Email sudah digunakan")
  }
  const now = new Date().toISOString()
  const row: UserStored = {
    id: nextId(rows),
    email: input.email,
    name: input.name,
    role: input.role,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    password: input.password,
  }
  rows.unshift(row)
  writeAll(rows)
  return strip(row)
}

export async function get(id: number): Promise<UserRow> {
  const row = readAll().find(r => r.id === id)
  if (!row) throw new Error("Pengguna tidak ditemukan")
  return strip(row)
}

export type UpdateUserInput = {
  name: string
  email: string
  role: Role
  isActive: boolean
  password?: string
}

export async function update(id: number, input: UpdateUserInput): Promise<UserRow> {
  const rows = readAll()
  const idx = rows.findIndex(r => r.id === id)
  if (idx === -1) throw new Error("Pengguna tidak ditemukan")
  const now = new Date().toISOString()
  const merged: UserStored = {
    ...rows[idx],
    name: input.name,
    email: input.email,
    role: input.role,
    isActive: input.isActive,
    updatedAt: now,
    ...(input.password ? { password: input.password } : {}),
  }
  rows[idx] = merged
  writeAll(rows)
  return strip(merged)
}
