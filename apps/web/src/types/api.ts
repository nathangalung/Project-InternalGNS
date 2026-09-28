import type * as G from "./generated"

// Wire types from Go DTOs.
//
// generated.ts is the contract; `make gen-types` rewrites it from the Go
// DTOs. This file re-exports it under the names the app imports, narrows the
// few fields Go sends as a plain string whose values only the database or a
// Go literal fixes, and adds the query types that never cross as JSON.

export type {
  AddVendorToItemInput,
  ChangeInvoiceStatusInput,
  ChangeOwnPasswordInput,
  ChangeUserPasswordInput,
  ClientRow,
  ClientSearchHit,
  ClientSummary,
  ContactRow,
  CountryRow,
  CreateClientInput,
  CreateContactInput,
  CreateItemInput,
  CreateUserInput,
  CreateVendorInput,
  DashboardStatusCount,
  DashboardSummary,
  DashboardTimeseriesPoint,
  InvoiceBackendRow,
  InvoiceBackendStatus,
  InvoiceDatesSaved,
  InvoiceDetail,
  InvoiceItemRow,
  InvoiceStatusEvent,
  InvoiceSummary,
  InvoiceTransition,
  ItemPriceHistoryRow,
  ItemRow,
  ItemVendorRow,
  LoginInput,
  LoginResponse,
  LogoutInput,
  MatchRowInput,
  MatchRowsInput,
  MatchRowsResponse,
  MeUser,
  ObjectKeyInput,
  PoBackendStatus,
  PoCompletenessIssue,
  PoDetailsInput,
  PoFileInput,
  PoIncompleteProblem,
  PoIssueKind,
  PoItemInput,
  PoSaved,
  PoStatusEvent,
  PoStatusInput,
  PoTransition,
  PoUpdateItemsInput,
  PresignDownload,
  PresignFileDownload,
  PresignUpload,
  ProblemDetail,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  QuotationContactInput,
  QuotationCreated,
  QuotationCreateInput,
  QuotationDetail,
  QuotationItemInput,
  QuotationItemRow,
  QuotationListRow,
  QuotationReviseInput,
  QuotationRevisionRow,
  QuotationRfqRows,
  QuotationSaved,
  QuotationSendInput,
  QuotationStatus,
  QuotationStatusCount,
  QuotationStatusEvent,
  QuotationStatusInput,
  QuotationTransition,
  QuotationUpdateInput,
  Role,
  UnitRow,
  UpdateClientInput,
  UpdateContactInput,
  UpdateInvoiceDatesInput,
  UpdateItemInput,
  UpdateUserInput,
  UpdateVendorInput,
  UserRow,
  VendorContactInfo,
  VendorItemRow,
  VendorRow,
} from "./generated"

// Replaces plain-string fields.
type Narrow<T, N> = Omit<T, keyof N> & N

export type RefreshResponse = G.LoginResponse

// Tier labels from items/merge.go.
export type AdvancedSearchTier =
  | "ITEM_AUTO"
  | "VENDOR_OFFER"
  | "ITEM_SUGGESTED"
  | "REQUEST_HISTORY"
  | "ITEM_FUZZY"

export type AdvancedSearchHit = Narrow<
  G.AdvancedSearchHit,
  { tier: AdvancedSearchTier; tiers: AdvancedSearchTier[] }
>

export type AdvancedSearchResponse = Narrow<
  G.AdvancedSearchResponse,
  { hits: AdvancedSearchHit[]; counts: Partial<Record<AdvancedSearchTier, number>> }
>

// Request log values.
//
// The quotation_item_requests CHECK constraints fix these; Go passes them
// through as text.
export type QuotationMatchStatus = "pending" | "matched" | "substituted" | "unavailable"
export type QuotationRequestSource = "manual" | "ocr" | "import"

type RequestKinds = { matchStatus: QuotationMatchStatus; sourceType: QuotationRequestSource }

export type QuotationItemRequestRow = Narrow<G.QuotationItemRequestRow, RequestKinds>

export type QuotationItemRequestCreateInput = Narrow<
  G.QuotationItemRequestCreateInput,
  Partial<RequestKinds>
>

export type QuotationItemRequestUpdateInput = Narrow<
  G.QuotationItemRequestUpdateInput,
  RequestKinds
>

// Query-only types.
export type QuotationSortKey = "quotationNo" | "version" | "createdAt" | "grandTotal"

export type QuotationListParams = {
  q?: string
  statuses?: G.QuotationStatus[]
  dateFrom?: string
  dateTo?: string
  minTotal?: string
  maxTotal?: string
  sortBy?: QuotationSortKey
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

export type DashboardMetric = "quotation" | "invoice" | "revenue" | "profit" | "ppn"
