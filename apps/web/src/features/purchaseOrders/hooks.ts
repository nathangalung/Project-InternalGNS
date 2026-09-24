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
import { ApiError } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { roleCanAccess } from "@/lib/rbac"
import { uploadWithFreshKey } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"
import type { PoBackendStatus, PoUpdateItemsInput } from "@/types/api"
import { detailsChanged } from "./adapters"
import {
  isInvoiceFiled,
  isPoLockRefusal,
  isVersionConflict,
  parseCompletenessIssues,
  poErrorMessage,
} from "./PurchaseOrderDetail/helpers"
import type { PoRow } from "./types"

// Under purchaseOrders.all, so one invalidation reaches it.
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

// Filed invoice freezes number and date.
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

// The completeness 422 opens a modal instead of a toast.
export function useChangePoStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: PoBackendStatus; note?: string }) =>
      poApi.changeStatus(id, status, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
    onError: (err) => {
      if (err instanceof ApiError && parseCompletenessIssues(err.body)) return
      toast.error(errorMessage(err, "Gagal mengubah status PO."))
    },
  })
}

// Stale version refetches the PO.
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
    onError: (err) => reportPoError(qc, err, "Gagal memperbarui detail PO."),
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
    },
    onError: (err) => reportPoError(qc, err, "Gagal memperbarui item PO."),
  })
}

// Upload modal: locks and save.
//
// Attaching a file bumps row_version, so the details write goes first while
// the version the user loaded is still current. Both hooks toast their own
// errors; save only says whether to close the modal.
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
  ): Promise<boolean> {
    if (!row) return false
    let step: "details" | "file" = "details"
    try {
      if (detailsChanged(row, details)) {
        await updateDetails.mutateAsync({ id: row.id, ...details, rowVersion: row.rowVersion })
      }
      step = "file"
      if (file) await uploadFile.mutateAsync({ id: row.id, file })
      return true
    } catch (err) {
      if (step === "details" && isPoLockRefusal(err)) setRefusedId(row.id)
      return false
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
