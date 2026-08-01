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
  refreshToken: string
  refreshExpiresAt: number
  user: MeUser
}

export type RefreshResponse = LoginResponse

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
  totalPurchase: string
  quotationCount: number
  logoObjectKey?: string
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

export type ClientSummary = {
  total: number
  activeCount: number
  newThisMonth: number
  newThisYear: number
  prevYearTotal: number
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
  matchTier: "AUTO_MATCH" | "SUGGESTED" | "FUZZY"
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
  imageObjectKey?: string
}

// Tier label exposed by /items/search-advanced.
export type AdvancedSearchTier =
  | "ITEM_AUTO"
  | "VENDOR_OFFER"
  | "ITEM_SUGGESTED"
  | "REQUEST_HISTORY"
  | "ITEM_FUZZY"

export type AdvancedSearchHit = {
  id: number
  name: string
  impaCode?: string
  defaultUnitId?: number
  score: number
  tier: AdvancedSearchTier
  tiers: AdvancedSearchTier[]
  vendorId?: number
  vendorName?: string
  vendorSku?: string
  requestText?: string
}

export type AdvancedSearchResponse = {
  query: string
  total: number
  hits: AdvancedSearchHit[]
  counts: Partial<Record<AdvancedSearchTier, number>>
}

// Batch row match for xlsx upload.
export type MatchRowInput = {
  impaCode: string
  name: string
  qty: number
  unit: string
}

type MatchedItemWithVendor = {
  itemId: number
  itemName: string
  impaCode?: string
  defaultUnitId?: number
  defaultUnitCode?: string
  vendorProductId?: number
  vendorId?: number
  vendorName?: string
  costPrice?: string
}

type MatchRowResult = {
  index: number
  requested: MatchRowInput
  matched?: MatchedItemWithVendor
  confidence: number
  source: string
}

export type MatchRowsResponse = {
  rows: MatchRowResult[]
}

export type ItemVendorRow = {
  vendorProductId: number
  vendorId: number
  vendorName: string
  vendorSku?: string
  costPrice?: string
  productUrl?: string
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

// Users / staff admin.
export type UserRow = {
  id: number
  email: string
  name: string
  role: Role
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// Vendors master and search.
export type VendorContactInfo = {
  email?: string
  phone?: string
  sku?: string
}

export type VendorRow = {
  id: number
  name: string
  location?: string
  contactInfo?: VendorContactInfo
  isActive: boolean
  createdAt: string
  updatedAt: string
  productCount: number
  totalPurchase: string
  logoObjectKey?: string
}

export type VendorItemRow = {
  itemId: number
  itemName: string
  impaCode?: string
  vendorSku?: string
  costPrice?: string
  lastQuotedAt?: string
  productUrl?: string
}

// Quotation list, detail, and writes.
export type QuotationListRow = {
  id: number
  quotationNo: string
  version: number
  companyName: string
  status: CanonicalStatus
  grandTotal: string
  subtotal: string
  totalDiscount: string
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
  shippingDays?: number
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
  subtotal: string
  dppNilaiLain: string
  ppnAmount: string
  grandTotal: string
  notes?: string
  rowVersion: number
  createdAt: string
  updatedAt: string
  items: QuotationItemRow[]
  history: QuotationStatusEvent[]
}

export type QuotationRevisionRow = {
  id: number
  parentId?: number
  quotationNo: string
  version: number
  status: CanonicalStatus
  grandTotal: string
  totalProduk: string
  createdAt: string
  updatedAt: string
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
  dateFrom?: string
  dateTo?: string
  minTotal?: string
  maxTotal?: string
  sortBy?: string
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

// Pre-quotation request log (QIR).
export type QuotationMatchStatus = "pending" | "matched" | "substituted" | "unavailable"
export type QuotationRequestSource = "manual" | "ocr" | "import"

export type QuotationItemRequestRow = {
  id: number
  quotationId: number
  lineNo: number
  requestText: string
  requestImpa?: string
  requestedQty?: string
  requestedUom?: string
  matchedItemId?: number
  matchStatus: QuotationMatchStatus
  sourceType: QuotationRequestSource
  sourceRef?: string
  notes?: string
  reviewedBy?: number
  reviewedAt?: string
  rowVersion: number
  createdBy: number
  updatedBy?: number
  createdAt: string
  updatedAt: string
}

export type QuotationItemRequestCreateInput = {
  lineNo: number
  requestText: string
  requestImpa?: string
  requestedQty?: string
  requestedUom?: string
  matchedItemId?: number
  matchStatus?: QuotationMatchStatus
  sourceType?: QuotationRequestSource
  sourceRef?: string
  notes?: string
}

export type QuotationItemRequestUpdateInput = {
  lineNo: number
  requestText: string
  requestImpa?: string
  requestedQty?: string
  requestedUom?: string
  matchedItemId?: number
  matchStatus: QuotationMatchStatus
  sourceType: QuotationRequestSource
  sourceRef?: string
  notes?: string
}

// Purchase orders.
export type PoBackendStatus = "PENDING" | "UPLOADED" | "ON_PROGRESS" | "DELIVERED"

export type PurchaseOrderRow = {
  id: number
  poNumber: string
  quotationId: number
  quotationNo: string
  companyClientId: number
  companyName: string
  poDate: string
  status: PoBackendStatus
  fileName?: string
  fileSize?: number
  uploadedAt?: string
  notes?: string
  objectKey?: string
  quotationTotal?: string
  quotationSubtotal?: string
  poSubtotal: string
  poTotalProduk: string
  poTotalProfit: string
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export type PoItemInput = {
  quotationItemId?: number
  offeredItemId?: number
  itemName: string
  itemCode?: string
  qty: string
  unitId?: number
  sellingPrice: string
  costPrice?: string
  isAvailable?: boolean
  shipDestination?: string
}

export type PoUpdateItemsInput = {
  discountPct: string
  notes?: string
  shippingAddress?: string
  shippingDays?: number
  shippingCost?: string
  items: PoItemInput[]
}

export type PurchaseOrderItemRow = {
  id: number
  poId: number
  quotationItemId?: number
  lineNumber: number
  itemType: "product" | "shipping"
  offeredItemId?: number
  itemCode?: string
  itemName: string
  qty: string
  unitId?: number
  unitCode?: string
  sellingPrice: string
  costPrice?: string
  subtotal: string
  totalSelling: string
  profitAmount?: string
  shipDestination?: string
  isAvailable: boolean
}

// Invoices.
export type InvoiceBackendStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled"

export type InvoiceBackendRow = {
  id: number
  invoiceNo: string
  quotationId: number
  quotationNo: string
  poId?: number
  companyClientId: number
  companyName: string
  invoiceDate: string
  dueDate?: string
  subtotal?: string
  dpp?: string
  dppNilaiLain?: string
  ppnAmount?: string
  total?: string
  status: InvoiceBackendStatus
  taxTransactionCode?: string
  fakturType?: string
  rowVersion: number
  createdAt: string
  updatedAt: string
  attachmentObjectKey?: string
}

export type InvoiceItemRow = {
  id: number
  invoiceId: number
  lineNumber?: number
  lineType: "product" | "shipping"
  itemCode?: string
  itemName: string
  offeredItemId?: number
  unitId?: number
  unitCode?: string
  unitCoretaxCode?: string
  qty: string
  unitPrice: string
  costPrice?: string
  dpp?: string
  dppNilaiLain?: string
  ppnRate?: string
  ppnAmount?: string
  shipDestination?: string
  goodsOrService?: string
}

export type InvoiceSummary = {
  total: number
  draft: number
  sent: number
  paid: number
  overdue: number
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

export type PresignUpload = {
  uploadUrl: string
  objectKey: string
  expiresAt: number
}

export type PresignDownload = {
  downloadUrl: string
  fileName?: string
  expiresAt: number
}
