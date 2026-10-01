import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import * as quotationsApi from "@/features/quotations/api"
import { nextExpiry } from "@/features/quotations/live"
import { statusChangeToast } from "@/features/quotations/status"
import { errorMessage } from "@/lib/errors"
import { followEventStream } from "@/lib/event-stream"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import type {
  QuotationEditLock,
  QuotationItemRequestCreateInput,
  QuotationItemRequestUpdateInput,
  QuotationListParams,
  QuotationStatus,
} from "@/types/api"

// Caches a quotation write touches.
//
// Client and vendor pages show quotation counts.
function invalidateQuotationDeps(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.quotations.all })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
  qc.invalidateQueries({ queryKey: queryKeys.clients.all })
  qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
}

export function useQuotations(params: QuotationListParams = {}) {
  return useQuery({
    queryKey: queryKeys.quotations.list(params as Record<string, unknown>),
    queryFn: () => quotationsApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useQuotation(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.quotations.detail(id) : queryKeys.quotations.all,
    queryFn: id !== undefined && id > 0 ? () => quotationsApi.get(id) : skipToken,
  })
}

export function useQuotationStats() {
  return useQuery({
    queryKey: queryKeys.quotations.stats(),
    queryFn: quotationsApi.stats,
  })
}

export function useCreateQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: quotationsApi.create,
    onSuccess: () => invalidateQuotationDeps(qc),
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan quotation.")),
  })
}

export function useChangeQuotationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: QuotationStatus; note?: string }) =>
      status === "sent"
        ? quotationsApi.send(id, note)
        : quotationsApi.changeStatus(id, status, note),
    onSuccess: () => {
      invalidateQuotationDeps(qc)
      // Accepting creates a PO.
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
    },
    onError: (err) => {
      const msg = statusChangeToast(err)
      if (msg) toast.error(msg)
    },
  })
}

// Buat Revisi mutation.
export function useReviseQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => quotationsApi.revise(id, note),
    onSuccess: () => invalidateQuotationDeps(qc),
    onError: (err) => toast.error(errorMessage(err, "Gagal membuat revisi quotation.")),
  })
}

export function useUpdateQuotationContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, contactId }: { id: number; contactId: number }) =>
      quotationsApi.updateQuotationContact(id, contactId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengubah narahubung quotation.")),
  })
}

export function useQuotationRevisions(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.quotations.revisions(id) : queryKeys.quotations.all,
    queryFn: id !== undefined && id > 0 ? () => quotationsApi.listRevisions(id) : skipToken,
  })
}

export function useQuotationRequests(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId ? queryKeys.quotations.requests(quotationId) : queryKeys.quotations.all,
    queryFn:
      quotationId !== undefined && quotationId > 0
        ? () => quotationsApi.listRequests(quotationId)
        : skipToken,
  })
}

type UpsertArgs =
  | { quotationId: number; requestId?: undefined; input: QuotationItemRequestCreateInput }
  | { quotationId: number; requestId: number; input: QuotationItemRequestUpdateInput }

export function useUpsertQuotationRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: UpsertArgs) => {
      if (args.requestId === undefined) {
        return quotationsApi.createRequest(args.quotationId, args.input)
      }
      return quotationsApi.updateRequest(args.quotationId, args.requestId, args.input)
    },
    onSuccess: (_, { quotationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.requests(quotationId) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan item request.")),
  })
}

export function useDeleteQuotationRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ quotationId, requestId }: { quotationId: number; requestId: number }) =>
      quotationsApi.deleteRequest(quotationId, requestId),
    onSuccess: (_, { quotationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.requests(quotationId) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menghapus item request.")),
  })
}

// PDF download, Indonesian toast.
export async function downloadQuotationPdf(id: number, quotationNo: string): Promise<void> {
  try {
    await quotationsApi.downloadPdfFile(id, quotationNo)
  } catch {
    toast.error("Gagal mengunduh PDF quotation. Coba lagi.")
  }
}

// XLSX export, Indonesian toast.
export async function exportQuotationsXlsx(params: QuotationListParams): Promise<void> {
  try {
    await quotationsApi.exportXlsx(params)
  } catch {
    toast.error("Gagal mengekspor daftar quotation. Coba lagi.")
  }
}

// Claim renewal period
export const LOCK_HEARTBEAT_MS = 30_000

// Follow a draft live.
//
// Every change notice, and every reconnect (the stream keeps no backlog),
// reloads the quotation. An expired claim sends no notice, so the page also
// reloads when another user's claim lapses.
export function useQuotationLive(
  id: number | undefined,
  locks: QuotationEditLock[] | undefined,
  meId: number | undefined,
) {
  const qc = useQueryClient()
  useEffect(() => {
    if (id === undefined) return
    const ctl = new AbortController()
    void followEventStream({
      open: (signal) => quotationsApi.openEvents(id, signal),
      onEvent: () => qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) }),
      signal: ctl.signal,
    })
    return () => ctl.abort()
  }, [id, qc])

  const expiry = locks ? nextExpiry(locks, meId) : undefined
  useEffect(() => {
    if (id === undefined || expiry === undefined) return
    const timer = setTimeout(
      () => qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) }),
      Math.max(expiry - Date.now(), 0) + 1000,
    )
    return () => clearTimeout(timer)
  }, [id, expiry, qc])
}

// The caller's claims on a draft.
//
// acquire claims a part and toasts the server's refusal, which names the
// editor holding it. Held parts are renewed on a heartbeat; one the server
// no longer grants is dropped. Leaving the page releases them all, and a
// closed tab's claims lapse on the server.
export function useEditLocks(id: number | undefined) {
  const held = useRef(new Set<string>())
  const [heldParts, setHeldParts] = useState<ReadonlySet<string>>(() => new Set())
  const sync = useCallback(() => setHeldParts(new Set(held.current)), [])
  // False once the page has left; a claim granted after that is freed.
  const active = useRef(false)

  const acquire = useCallback(
    async (part: string, opts: { quiet?: boolean } = {}): Promise<boolean> => {
      if (id === undefined) return false
      try {
        await quotationsApi.lockPart(id, part)
      } catch (err) {
        if (!opts.quiet) toast.error(errorMessage(err, "Bagian ini tidak dapat dibuka."))
        return false
      }
      if (!active.current) {
        void quotationsApi.unlockPart(id, part).catch(() => undefined)
        return false
      }
      held.current.add(part)
      sync()
      return true
    },
    [id, sync],
  )

  const release = useCallback(
    async (part: string): Promise<void> => {
      if (id === undefined || !held.current.delete(part)) return
      sync()
      // A failed release lapses on the server.
      await quotationsApi.unlockPart(id, part).catch(() => undefined)
    },
    [id, sync],
  )

  useEffect(() => {
    if (id === undefined) return
    const parts = held.current
    active.current = true
    const timer = setInterval(() => {
      for (const part of parts) {
        quotationsApi.lockPart(id, part).catch(() => {
          parts.delete(part)
          sync()
        })
      }
    }, LOCK_HEARTBEAT_MS)
    // Leaving the page or the tab frees every part.
    const releaseAll = (keepalive: boolean) => {
      for (const part of parts) {
        void quotationsApi.unlockPart(id, part, keepalive).catch(() => undefined)
      }
      parts.clear()
    }
    const onPageHide = () => {
      releaseAll(true)
      sync()
    }
    window.addEventListener("pagehide", onPageHide)
    return () => {
      clearInterval(timer)
      active.current = false
      window.removeEventListener("pagehide", onPageHide)
      releaseAll(false)
    }
  }, [id, sync])

  return { acquire, release, holds: (part: string) => heldParts.has(part) }
}

// One live change to a draft.
//
// The change is a thunk over the api, so one mutation serves every line and
// header save. The quotation reloads after it either way: a refusal may mean
// the draft changed underneath.
export function useLiveChange(id: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (change: () => Promise<unknown>) => change(),
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan perubahan.")),
    onSettled: () => {
      if (id !== undefined) qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) })
    },
  })
}
