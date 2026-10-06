import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import type { CashEntryInput } from "@/types/api"
import * as cashApi from "./api"

export function useCashEntries(params: cashApi.CashEntryParams) {
  return useQuery({
    queryKey: queryKeys.cashEntries.list(params),
    queryFn: () => cashApi.list(params),
    placeholderData: keepPreviousData,
  })
}

// Totals of the filtered entries.
export function useCashSummary(params: cashApi.CashEntryParams) {
  return useQuery({
    queryKey: queryKeys.cashEntries.summary(params),
    queryFn: () => cashApi.summary(params),
    placeholderData: keepPreviousData,
  })
}

// Category suggestions.
// The form works without them, so a failure stays out of the way.
export function useCashCategories() {
  return useQuery({
    queryKey: queryKeys.cashEntries.categories(),
    queryFn: cashApi.categories,
    throwOnError: false,
  })
}

type SaveArgs = { input: CashEntryInput } & (
  | { id?: undefined }
  | { id: number; rowVersion: number }
)

// Adds or edits one entry.
// Failures show in the form.
export function useSaveCashEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: SaveArgs) =>
      args.id === undefined
        ? cashApi.create(args.input)
        : cashApi.update(args.id, args.input, args.rowVersion),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cashEntries.all }),
  })
}

export function useDeleteCashEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: cashApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cashEntries.all })
      toast.success("Catatan kas dihapus.")
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menghapus catatan kas.")),
  })
}
