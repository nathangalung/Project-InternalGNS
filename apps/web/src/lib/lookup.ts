type LookupQuery = { isError: boolean; isFetching: boolean; refetch: () => unknown }

// Spreads into LoadError.
export type LookupFailure = { onRetry: () => void; retrying: boolean }

// Failed lookups, retried together.
//
// Null while none failed. The dialog shows the failure beside its field
// instead of letting it reach the route error boundary, which would discard
// the quotation or PO being edited.
export function lookupFailure(...queries: LookupQuery[]): LookupFailure | null {
  const failed = queries.filter((q) => q.isError)
  if (failed.length === 0) return null
  return {
    onRetry: () => {
      for (const q of failed) void q.refetch()
    },
    retrying: failed.some((q) => q.isFetching),
  }
}
