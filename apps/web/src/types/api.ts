export type Role = "superadmin" | "operational" | "finance"

export type CanonicalStatus = "draft" | "sent" | "accepted" | "rejected" | "revision" | "expired"

export type MeUser = {
  id: number
  email: string
  name: string
  role: Role
}

export type LoginResponse = {
  token: string
  expiresAt: number
  user: MeUser
}

export type ClientRow = {
  id: number
  number?: string
  name: string
  npwp?: string
  address?: string
  email?: string
  countryCode: string
  tkuId?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  contactId?: number
  contactName?: string
  contactEmail?: string
  contactPhone?: string
}

export type ContactRow = {
  id: number
  companyId: number
  name: string
  email?: string
  phone?: string
  title?: string
  countryCode: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ClientSearchHit = {
  companyId: number
  companyName: string
  companyNumber?: string
  companyNpwp?: string
  companyAddress?: string
  companyEmail?: string
  companyCountry: string
  companyTku?: string
  contactId?: number
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  contactTitle?: string
  score: number
  matchTier: string
}

// Master tables consumed by dropdowns.
export type UnitRow = {
  id: number
  code: string
  name?: string
  coretaxCode?: string
}

export type CountryRow = {
  code: string
  name: string
  dialCode: string
}

// Items master and search.
export type ItemRow = {
  id: number
  name: string
  impaCode?: string
  defaultUnitId?: number
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ItemSearchHit = {
  id: number
  name: string
  impaCode?: string
  defaultUnitId?: number
  score: number
  matchTier: string
}

export type ItemMatchHit = {
  itemId: number
  itemName: string
  impaCode?: string
  confidence: number
  source: string
}

export type ItemVendorRow = {
  vendorProductId: number
  vendorId: number
  vendorName: string
  vendorSku?: string
  costPrice?: string
  lastQuotedAt?: string
}

export type ItemPriceHistoryRow = {
  quotationNo: string
  quotationDate: string
  clientName: string
  qty: string
  costPrice?: string
  sellingPrice: string
  profitPct?: string
}

// Vendors master and search.
export type VendorRow = {
  id: number
  name: string
  location?: string
  contactInfo?: unknown
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type VendorSearchHit = {
  vendorId: number
  vendorName: string
  location?: string
  contactInfo?: unknown
  score: number
  matchTier: string
}

export type VendorItemRow = {
  itemId: number
  itemName: string
  impaCode?: string
  vendorSku?: string
  costPrice?: string
  lastQuotedAt?: string
}

// Quotation list, detail, and writes.
export type QuotationListRow = {
  id: number
  quotationNo: string
  version: number
  companyName: string
  status: CanonicalStatus
  total: string
  totalHargaBeli: string
  createdAt: string
}

export type QuotationStatusCount = {
  status: CanonicalStatus
  count: number
}

export type QuotationItemRow = {
  id: number
  quotationId: number
  lineNumber: number
  itemType: "product" | "shipping"
  requestedItemId?: number
  requestedImpa?: string
  requestedName: string
  offeredItemId?: number
  vendorProductId?: number
  qty: string
  unitId?: number
  sellingPrice: string
  costPrice?: string
  discountPct: string
  totalSelling: string
  discountAmount: string
  subtotal: string
  isAvailable: boolean
  shipDestination?: string
}

export type QuotationStatusEvent = {
  id: number
  fromStatus?: CanonicalStatus
  toStatus: CanonicalStatus
  note?: string
  changedBy: number
  changedAt: string
}

export type QuotationDetail = {
  id: number
  quotationNo: string
  version: number
  companyClientId: number
  companyClientName: string
  contactId?: number
  contactName?: string
  clientRefNo?: string
  vesselName?: string
  status: CanonicalStatus
  paymentTerms?: string
  validityDays?: number
  discountPct: string
  totalProduk: string
  total: string
  totalDiscount: string
  notes?: string
  createdAt: string
  updatedAt: string
  items: QuotationItemRow[]
  history: QuotationStatusEvent[]
}

export type QuotationItemInput = {
  requestedItemId?: number
  requestedImpa?: string
  requestedName: string
  offeredItemId?: number
  vendorProductId?: number
  qty: string
  unitId: number
  sellingPrice: string
  costPrice?: string
  updateVendorPrice?: boolean
  shipDestination?: string
  dueDate?: string
}

export type QuotationCreateInput = {
  companyClientId: number
  contactId?: number
  clientRefNo?: string
  vesselName?: string
  paymentTerms?: string
  validityDays?: number
  discountPct: string
  shippingAddress?: string
  shippingDays?: number
  shippingCost?: string
  items: QuotationItemInput[]
  notes?: string
  status?: CanonicalStatus
}

export type QuotationUpdateInput = Omit<
  QuotationCreateInput,
  "companyClientId" | "contactId" | "status"
>

export type QuotationListParams = {
  q?: string
  statuses?: CanonicalStatus[]
  sortBy?: string
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

// Dashboard aggregates and chart data.
export type DashboardSummary = {
  totalRevenue: string
  totalExpenses: string
  totalProfit: string
  totalPpn: string
  totalQuotations: number
  totalQuotationsRejected: number
  totalPo: number
  totalInvoices: number
  totalInvoicesPaid: number
  invoicesDueSoon: number
  invoicesOverdue: number
}

export type DashboardMetric = "quotation" | "invoice" | "revenue" | "profit" | "ppn"

export type DashboardTimeseriesPoint = {
  month: string
  value: string
}
