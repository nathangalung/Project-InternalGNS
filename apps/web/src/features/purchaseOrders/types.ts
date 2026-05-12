import type { PoBackendStatus } from "@/types/api"

export type PoStatus = PoBackendStatus

export interface PoRow {
  quotationId: number
  quotationNo: string
  poNumber: string
  client: string
  date: string
  total: string
  status: PoStatus
  fileName?: string
  objectKey?: string
}
