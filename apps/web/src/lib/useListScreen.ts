import {
  type AnyRouter,
  type NavigateOptions,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  compact,
  type ListSchema,
  type ListSort,
  type ListState,
  type RawSearch,
  readList,
  writeList,
} from "@/lib/list-search"
import { clampPage, pageCount } from "@/lib/pagination"

export type ListScreen<F, K extends string = never> = {
  // The search box text, as typed
  search: string
  // The term the list queries, from the URL
  debouncedSearch: string
  // Resets to page 1, like typing in the search box.
  setSearch: (value: string) => void
  // Clears the term but keeps the current page.
  clearSearch: () => void
  filters: F
  // Resets to page 1, like applying a filter panel.
  applyFilters: (next: F) => void
  // Partial update that keeps the current page.
  patchFilters: (update: (prev: F) => F) => void
  sort: ListSort<K> | null
  // Resets to page 1.
  setSort: (next: ListSort<K>) => void
  currentPage: number
  setCurrentPage: (page: number) => void
  itemsPerPage: number
  setItemsPerPage: (count: number) => void
  startIndex: number
  totalPagesOf: (totalItems: number) => number
  // A search or filters off their defaults hide some rows.
  narrowed: boolean
}

// Wait before a typed search is written.
const SEARCH_DELAY = 250

// Shared list state machine.
//
// The state lives in the route's search params (lib/list-search). Every
// change replaces the history entry, keeping its trail and its scroll, so
// the back button leaves the list instead of undoing each change. Typing
// shows at once in the box and reaches the URL once it settles.
//
// path is the list's own route path ("/quotations", "/vendors/$id"), so a
// write always targets that route. A write made after the list closed, or
// once the reader is leaving it, does nothing.
export function useListScreen<F, K extends string = never>(
  schema: ListSchema<F, K>,
  path: string,
): ListScreen<F, K> {
  const navigate = useNavigate()
  const history = useRouter().history
  const raw: RawSearch = useSearch({ strict: false })
  const state = useMemo(() => readList(schema, raw), [schema, raw])

  const [search, setSearchText] = useState(state.q)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The pathname the list opened on
  const home = useRef(history.location.pathname)
  const open = useRef(true)

  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
      clearTimeout(pending.current)
    }
  }, [])

  // Read and write the URL in one step, so two changes made in one go
  // both land. History moves to the next page as soon as a link is
  // followed, before the list closes, so its pathname tells a late write.
  // The options are typed for any route, since the hook serves every list.
  const commit = useCallback(
    (update: (prev: ListState<F, K>) => ListState<F, K>) => {
      if (!open.current || history.location.pathname !== home.current) return
      const options: NavigateOptions<AnyRouter> = {
        to: path,
        params: true,
        search: (prev: RawSearch) => writeList(schema, update(readList(schema, prev))),
        state: true,
        replace: true,
        resetScroll: false,
      }
      void navigate(options)
    },
    [navigate, history, path, schema],
  )

  // Follow a URL changed elsewhere.
  //
  // A history back, a crumb or the menu can land on this list without a
  // remount. Text still waiting to be written is left alone.
  useEffect(() => {
    if (pending.current !== undefined) return
    setSearchText((typed) => (typed.trim() === state.q ? typed : state.q))
  }, [state.q])

  const setSearch = useCallback(
    (value: string) => {
      setSearchText(value)
      clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        pending.current = undefined
        commit((s) => ({ ...s, q: value.trim(), page: 1 }))
      }, SEARCH_DELAY)
    },
    [commit],
  )

  const clearSearch = useCallback(() => {
    clearTimeout(pending.current)
    pending.current = undefined
    setSearchText("")
    commit((s) => ({ ...s, q: "" }))
  }, [commit])

  const applyFilters = useCallback(
    (next: F) => commit((s) => ({ ...s, filters: next, page: 1 })),
    [commit],
  )

  const patchFilters = useCallback(
    (update: (prev: F) => F) => commit((s) => ({ ...s, filters: update(s.filters) })),
    [commit],
  )

  const setSort = useCallback(
    (next: ListSort<K>) => commit((s) => ({ ...s, sort: next, page: 1 })),
    [commit],
  )

  const setCurrentPage = useCallback((page: number) => commit((s) => ({ ...s, page })), [commit])

  const setItemsPerPage = useCallback(
    (count: number) => commit((s) => ({ ...s, per: count, page: 1 })),
    [commit],
  )

  const filtersOff = Object.keys(compact(schema.writeFilters(state.filters))).length > 0

  return {
    search,
    debouncedSearch: state.q,
    setSearch,
    clearSearch,
    filters: state.filters,
    applyFilters,
    patchFilters,
    sort: state.sort,
    setSort,
    currentPage: state.page,
    setCurrentPage,
    itemsPerPage: state.per,
    setItemsPerPage,
    startIndex: (state.page - 1) * state.per,
    totalPagesOf: (totalItems) => pageCount(totalItems, state.per),
    narrowed: state.q !== "" || filtersOff,
  }
}

// Keep the page in range.
//
// Removing a chip keeps the page, and rows removed elsewhere shrink the
// total on the next fetch, so the server total can end before the page;
// the reader moves to the new last page. An unknown total (still loading)
// leaves the page alone.
export function usePageWithin<F, K extends string>(
  list: ListScreen<F, K>,
  totalItems: number | undefined,
): void {
  const { currentPage, setCurrentPage, itemsPerPage } = list
  useEffect(() => {
    if (totalItems === undefined) return
    const page = clampPage(currentPage, pageCount(totalItems, itemsPerPage))
    if (page !== currentPage) setCurrentPage(page)
  }, [totalItems, currentPage, itemsPerPage, setCurrentPage])
}
