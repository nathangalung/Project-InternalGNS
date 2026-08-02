import type { PoBackendStatus } from "@/types/api"

export type PoStatus = PoBackendStatus

export interface PoRow {
  id: number
  quotationId: number
  quotationNo: string
  poNumber: string
  poDate: string
  client: string
  date: string
  total: string
  status: PoStatus
  fileName?: string
  objectKey?: string
}
