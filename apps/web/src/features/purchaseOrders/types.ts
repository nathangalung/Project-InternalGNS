export type PoStatus = "PENDING" | "UPLOADED" | "ON_PROGRESS" | "DELIVERED"

export interface PoLocalRecord {
  status: PoStatus
  fileName?: string
  fileSize?: number
  fileDataUrl?: string
  uploadedAt?: string
}

export interface PoRow {
  quotationId: number
  quotationNo: string
  poNumber: string
  client: string
  date: string
  total: string
  status: PoStatus
  fileName?: string
  fileDataUrl?: string
}
