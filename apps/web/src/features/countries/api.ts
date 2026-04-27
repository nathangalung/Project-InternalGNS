import { apiRequest } from "@/lib/api-client"
import type { CountryRow } from "@/types/api"

export async function list(): Promise<CountryRow[]> {
  return apiRequest<CountryRow[]>({ path: "/countries" })
}
