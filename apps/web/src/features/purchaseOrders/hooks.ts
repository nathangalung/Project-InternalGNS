import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useState } from "react"
import { useMe } from "@/features/auth/hooks"
import * as invoicesApi from "@/features/invoices/api"
import * as poApi from "@/features/purchaseOrders/api"
import * as usersApi from "@/features/users/api"
import { errorMessage, isVersionConflict } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { roleCanAccess } from "@/lib/rbac"
import { uploadWithFreshKey } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"
import type { PoBackendStatus, PoUpdateItemsInput } from "@/types/api"
import { detailsChanged } from "./adapters"
import {
  completenessIssues,
  isInvoiceFiled,
  isPoLockRefusal,
  type PoDetailsErrors,
  poDetailsErrors,
  poErrorMessage,
} from "./PurchaseOrderDetail/helpers"
import type { PoRow } from "./types"

// History key under purchaseOrders.all.
//
// One invalidation of the prefix reaches it.
const historyKey = (id: number) => [...queryKeys.purchaseOrders.all, "history", id] as const

// Toast; reload a stale PO.
//
// A version race and a lock both mean the stored PO moved on, so the page
// reloads it; a lock also changes what the page offers, such as the edit
// button.
function reportPoError(qc: QueryClient, err: unknown, fallback: string) {
  if (isVersionConflict(err) || isPoLockRefusal(err)) {
    qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
  }
  toast.error(poErrorMessage(err, fallback))
}

export function usePurchaseOrders(params: poApi.ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.list(params),
    queryFn: () => poApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function usePurchaseOrder(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.purchaseOrders.detail(id) : queryKeys.purchaseOrders.all,
    queryFn: id !== undefined && id > 0 ? () => poApi.get(id) : skipToken,
  })
}

export function usePoItems(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.purchaseOrders.items(id) : queryKeys.purchaseOrders.all,
    queryFn: id !== undefined && id > 0 ? () => poApi.listItems(id) : skipToken,
  })
}

export function usePurchaseOrderByQuotation(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId
      ? queryKeys.purchaseOrders.byQuotation(quotationId)
      : queryKeys.purchaseOrders.all,
    queryFn:
      quotationId !== undefined && quotationId > 0
        ? () => poApi.getByQuotation(quotationId)
        : skipToken,
  })
}

// Proxy path of the PO file.
//
// Keyed by the stored object, so a replaced file asks again. The preview
// shows a failure itself, never on the route error boundary.
export function usePoFileUrl(id: number | undefined, objectKey: string | undefined) {
  return useQuery({
    queryKey: id
      ? [...queryKeys.purchaseOrders.detail(id), "file-url", objectKey]
      : queryKeys.purchaseOrders.all,
    queryFn: id !== undefined && id > 0 && objectKey ? () => poApi.presignDownload(id) : skipToken,
    throwOnError: false,
  })
}

export function usePoHistory(id: number | undefined) {
  return useQuery({
    queryKey: id ? historyKey(id) : queryKeys.purchaseOrders.all,
    queryFn: id !== undefined && id > 0 ? () => poApi.listHistory(id) : skipToken,
  })
}

// User names for the timeline.
//
// One lookup per distinct actor, usually one or two. Only superadmin may
// read users; everyone else sees the id.
export function useActorNames(ids: number[], enabled: boolean): Map<number, string> {
  return useQueries({
    queries: [...new Set(ids)].map((id) => ({
      queryKey: queryKeys.users.detail(id),
      queryFn: enabled ? () => usersApi.get(id) : skipToken,
    })),
    combine: (results) =>
      new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data.name] as const] : []))),
  })
}

// Filed invoice freezes number, date.
//
// Only roles that may read invoices ask; the rest rely on the server 409.
export function useInvoiceFiled(quotationId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.invoices.byQuotation(quotationId ?? 0),
    queryFn:
      enabled && quotationId !== undefined
        ? () => invoicesApi.getByQuotation(quotationId)
        : skipToken,
    select: (inv) => isInvoiceFiled(inv?.status),
    throwOnError: false, // Hint only; the server enforces the lock
  })
}

// Completeness 422: modal, not toast.
//
// Total Pembelian on the client and vendor pages leaves out a cancelled PO.
export function useChangePoStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: PoBackendStatus; note?: string }) =>
      poApi.changeStatus(id, status, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      qc.invalidateQueries({ queryKey: queryKeys.clients.all })
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
    },
    onError: (err) => {
      if (completenessIssues(err)) return
      toast.error(errorMessage(err, "Gagal mengubah status PO."))
    },
  })
}

// Stale version refetches the PO.
//
// The invoice shows No. PO and Tanggal PO, so it refreshes too. A 422 names
// a field the upload modal shows, so only the rest is toasted.
export function useUpdatePoDetails() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      poNumber,
      poDate,
      rowVersion,
    }: {
      id: number
      poNumber: string
      poDate: string
      rowVersion: number
    }) => poApi.updateDetails(id, { poNumber, poDate }, rowVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
    },
    onError: (err) => {
      if (poDetailsErrors(err)) return
      reportPoError(qc, err, "Gagal memperbarui detail PO.")
    },
  })
}

export function useRemovePoFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => poApi.removeFile(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
    onError: (err) => reportPoError(qc, err, "Gagal menghapus berkas PO."),
  })
}

// Full presigned upload flow.
export function useUploadPoFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("poDoc", file)
      const objectKey = await uploadWithFreshKey(() => poApi.presignUpload(id, file.name), file)
      await poApi.updateFile(id, { fileName: file.name, fileSize: file.size, objectKey })
    },
    // Attaching moves PENDING to UPLOADED.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
    onError: (err) => reportPoError(qc, err, "Gagal mengunggah berkas PO."),
  })
}

// Line edits move Total Pembelian, and a picked vendor may gain a product
// link, so the client, vendor and product pages refresh too.
export function useUpdatePoItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
      rowVersion,
    }: {
      id: number
      input: PoUpdateItemsInput
      rowVersion: number
    }) => poApi.updateItems(id, input, rowVersion),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.items(id) })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
      qc.invalidateQueries({ queryKey: queryKeys.clients.all })
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
      qc.invalidateQueries({ queryKey: queryKeys.items.all })
    },
    onError: (err) => reportPoError(qc, err, "Gagal memperbarui item PO."),
  })
}

// Outcome of an upload save.
//
// Saved closes the modal; errors are the details refusal it shows inline.
export type PoSaveResult = { saved: boolean; errors: PoDetailsErrors | null }

// Upload modal: locks and save.
//
// Attaching a file bumps row_version, so the details write goes first while
// the version the user loaded is still current. Both hooks toast the errors
// the modal cannot show; save says whether to close the modal and returns
// the details refusal for its fields.
//
// Number and date lock on a filed invoice. Roles that cannot read invoices
// learn it from a refused save, which then locks the fields for that PO.
// While the invoice is still loading the fields stay locked, so they never
// open and then snap shut.
export function usePoUpload(row: PoRow | undefined) {
  const { data: me } = useMe()
  const uploadFile = useUploadPoFile()
  const updateDetails = useUpdatePoDetails()
  const [refusedId, setRefusedId] = useState<number | null>(null)
  const filed = useInvoiceFiled(
    row?.quotationId,
    row?.status === "DELIVERED" && roleCanAccess(me?.role, "invoices"),
  )
  const detailsLocked = filed.data === true || (row !== undefined && refusedId === row.id)

  async function save(
    file: File | null,
    details: { poNumber: string; poDate: string },
  ): Promise<PoSaveResult> {
    if (!row) return { saved: false, errors: null }
    let step: "details" | "file" = "details"
    try {
      if (detailsChanged(row, details)) {
        await updateDetails.mutateAsync({ id: row.id, ...details, rowVersion: row.rowVersion })
      }
      step = "file"
      if (file) await uploadFile.mutateAsync({ id: row.id, file })
      return { saved: true, errors: null }
    } catch (err) {
      if (step === "file") return { saved: false, errors: null }
      if (isPoLockRefusal(err)) setRefusedId(row.id)
      return { saved: false, errors: poDetailsErrors(err) }
    }
  }

  return {
    save,
    isPending: uploadFile.isPending || updateDetails.isPending,
    detailsLocked,
    // Invoice lookup still in flight
    checking: filed.isLoading,
  }
}
