import {
  apiList,
  apiRequest,
  buildQuery,
  downloadPdf,
  downloadXlsx,
  type PaginatedList,
  postForm,
} from "@/lib/api-client"
import type {
  MatchRowInput,
  QuotationContactInput,
  QuotationCreated,
  QuotationCreateInput,
  QuotationDetail,
  QuotationItemRequestCreateInput,
  QuotationItemRequestRow,
  QuotationItemRequestUpdateInput,
  QuotationListParams,
  QuotationListRow,
  QuotationReviseInput,
  QuotationRevisionRow,
  QuotationRfqRows,
  QuotationSaved,
  QuotationSendInput,
  QuotationStatus,
  QuotationStatusCount,
  QuotationStatusInput,
  QuotationUpdateInput,
} from "@/types/api"

function buildListQuery(params: QuotationListParams): string {
  const { statuses, ...rest } = params
  return buildQuery({ ...rest, status: statuses })
}

export async function list(
  params: QuotationListParams = {},
): Promise<PaginatedList<QuotationListRow>> {
  const qs = buildListQuery(params)
  return apiList<QuotationListRow>({
    path: `/quotations${qs ? `?${qs}` : ""}`,
  })
}

// Filtered list XLSX download.
export function exportXlsx(params: QuotationListParams = {}): Promise<void> {
  const qs = buildListQuery(params)
  return downloadXlsx(`/quotations/export.xlsx${qs ? `?${qs}` : ""}`, "quotation-export.xlsx")
}

// Quotation PDF, safe filename.
export function downloadPdfFile(id: number, quotationNo: string): Promise<void> {
  const safe = quotationNo.replace(/[^A-Za-z0-9._-]/g, "_")
  return downloadPdf(`/quotations/${id}/pdf`, `${safe}.pdf`)
}

// Product rows of an RFQ file.
//
// The API reads the .xlsx or .csv and returns rows for match-rows.
export async function parseRfq(file: File): Promise<MatchRowInput[]> {
  const form = new FormData()
  form.append("file", file)
  const res = await postForm<QuotationRfqRows>("/quotations/rfq", form)
  return res.rows
}

export async function stats(): Promise<QuotationStatusCount[]> {
  return apiRequest<QuotationStatusCount[]>({ path: "/quotations/stats" })
}

export async function get(id: number): Promise<QuotationDetail> {
  return apiRequest<QuotationDetail>({ path: `/quotations/${id}` })
}

export async function create(input: QuotationCreateInput): Promise<QuotationCreated> {
  return apiRequest<QuotationCreated>({
    path: "/quotations",
    method: "POST",
    body: input,
  })
}

export async function update(
  id: number,
  input: QuotationUpdateInput,
  rowVersion: number,
): Promise<QuotationSaved> {
  return apiRequest<QuotationSaved>({
    path: `/quotations/${id}`,
    method: "PUT",
    body: input,
    headers: { "If-Match": String(rowVersion) },
  })
}

export async function changeStatus(
  id: number,
  status: QuotationStatus,
  note?: string,
): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${id}/status`,
    method: "PATCH",
    body: { status, note } satisfies QuotationStatusInput,
  })
}

export async function send(id: number, note?: string): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${id}/send`,
    method: "POST",
    body: note ? ({ note } satisfies QuotationSendInput) : undefined,
  })
}

// Clone as a new draft.
//
// Only a sent quotation can be revised. The original moves to Revisi and is frozen; the reply carries the new id.
export async function revise(id: number, note?: string): Promise<QuotationCreated> {
  return apiRequest<QuotationCreated>({
    path: `/quotations/${id}/revise`,
    method: "POST",
    body: (note ? { note } : {}) satisfies QuotationReviseInput,
  })
}

export async function updateQuotationContact(id: number, contactId: number): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${id}/contact`,
    method: "PATCH",
    body: { contactId } satisfies QuotationContactInput,
  })
}

export async function listRevisions(id: number): Promise<QuotationRevisionRow[]> {
  return apiRequest<QuotationRevisionRow[]>({ path: `/quotations/${id}/revisions` })
}

export async function listRequests(quotationId: number): Promise<QuotationItemRequestRow[]> {
  return apiRequest<QuotationItemRequestRow[]>({
    path: `/quotations/${quotationId}/requests`,
  })
}

export async function createRequest(
  quotationId: number,
  input: QuotationItemRequestCreateInput,
): Promise<QuotationItemRequestRow> {
  return apiRequest<QuotationItemRequestRow>({
    path: `/quotations/${quotationId}/requests`,
    method: "POST",
    body: input,
  })
}

export async function updateRequest(
  quotationId: number,
  requestId: number,
  input: QuotationItemRequestUpdateInput,
): Promise<QuotationItemRequestRow> {
  return apiRequest<QuotationItemRequestRow>({
    path: `/quotations/${quotationId}/requests/${requestId}`,
    method: "PUT",
    body: input,
  })
}

export async function deleteRequest(quotationId: number, requestId: number): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${quotationId}/requests/${requestId}`,
    method: "DELETE",
  })
}
