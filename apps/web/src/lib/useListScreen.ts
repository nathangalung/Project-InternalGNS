import { useCallback, useState } from "react"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"

export type ListScreen<F> = {
  search: string
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
  currentPage: number
  setCurrentPage: (page: number) => void
  itemsPerPage: number
  setItemsPerPage: (count: number) => void
  startIndex: number
  totalPagesOf: (totalItems: number) => number
}

// Shared list state machine.
export function useListScreen<F>(initialFilters: F, initialItemsPerPage = 10): ListScreen<F> {
  const [search, setSearchState] = useState("")
  const [filters, setFiltersState] = useState<F>(initialFilters)
  const [itemsPerPage, setItemsPerPageState] = useState(initialItemsPerPage)
  const [currentPage, setCurrentPage] = useState(1)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const startIndex = (currentPage - 1) * itemsPerPage

  const setSearch = useCallback((value: string) => {
    setSearchState(value)
    setCurrentPage(1)
  }, [])

  const clearSearch = useCallback(() => setSearchState(""), [])

  const applyFilters = useCallback((next: F) => {
    setFiltersState(next)
    setCurrentPage(1)
  }, [])

  const patchFilters = useCallback((update: (prev: F) => F) => setFiltersState(update), [])

  const setItemsPerPage = useCallback((count: number) => {
    setItemsPerPageState(count)
    setCurrentPage(1)
  }, [])

  return {
    search,
    debouncedSearch,
    setSearch,
    clearSearch,
    filters,
    applyFilters,
    patchFilters,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    startIndex,
    totalPagesOf: (totalItems) => Math.max(1, Math.ceil(totalItems / itemsPerPage)),
  }
}
