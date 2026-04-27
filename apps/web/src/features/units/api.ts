import { apiRequest } from "@/lib/api-client"
import type { UnitRow } from "@/types/api"

export async function list(): Promise<UnitRow[]> {
  return apiRequest<UnitRow[]>({ path: "/units" })
}
