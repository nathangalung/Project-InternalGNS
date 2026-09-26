import type { PoBackendStatus } from "@/types/api"

export type PoStatus = PoBackendStatus

export type PoRow = {
  id: number
  quotationId: number
  quotationNo: string
  poNumber: string
  poDate: string
  companyClientId: number
  client: string
  date: string
  total: string
  status: PoStatus
  // If-Match for the details save
  rowVersion: number
  deliveryNoteNumber?: string
  fileName?: string
  objectKey?: string
}
