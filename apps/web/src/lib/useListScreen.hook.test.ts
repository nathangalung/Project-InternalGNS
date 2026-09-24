import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@/test/renderHook"
import { type ListScreen, useListScreen } from "./useListScreen"

type Filters = { status: string; min: number }
const initial: Filters = { status: "all", min: 0 }

function setup(perPage?: number) {
  return renderHook(() => useListScreen(initial, perPage), undefined)
}

describe("useListScreen", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("starts on page 1 with the given filters and page size", () => {
    const { result } = setup(15)
    expect(result.current).toMatchObject({
      search: "",
      debouncedSearch: "",
      filters: initial,
      currentPage: 1,
      itemsPerPage: 15,
      startIndex: 0,
    })
  })

  it("defaults to ten rows a page", () => {
    expect(setup().result.current.itemsPerPage).toBe(10)
  })

  it("offsets the start index by the page", () => {
    const { result } = setup()
    act(() => result.current.setCurrentPage(3))
    expect(result.current.startIndex).toBe(20)
  })

  // Resetting mutators: the new result set starts at its first page.
  it.each<[string, (s: ListScreen<Filters>) => void]>([
    ["setSearch", (s) => s.setSearch("baut")],
    ["applyFilters", (s) => s.applyFilters({ status: "active", min: 5 })],
    ["setItemsPerPage", (s) => s.setItemsPerPage(5)],
  ])("%s returns to page 1", (_name, run) => {
    const { result } = setup()
    act(() => result.current.setCurrentPage(4))
    act(() => run(result.current))
    expect(result.current.currentPage).toBe(1)
  })

  // Removing a chip must keep the reader in place.
  it.each<[string, (s: ListScreen<Filters>) => void]>([
    ["clearSearch", (s) => s.clearSearch()],
    ["patchFilters", (s) => s.patchFilters((f) => ({ ...f, min: 0 }))],
  ])("%s keeps the current page", (_name, run) => {
    const { result } = setup()
    act(() => result.current.setSearch("baut"))
    act(() => result.current.setCurrentPage(4))
    act(() => run(result.current))
    expect(result.current.currentPage).toBe(4)
  })

  it("applies and patches filters", () => {
    const { result } = setup()
    act(() => result.current.applyFilters({ status: "active", min: 5 }))
    act(() => result.current.patchFilters((f) => ({ ...f, status: "all" })))
    expect(result.current.filters).toEqual({ status: "all", min: 5 })
  })

  it("debounces a trimmed search term by 250 ms", () => {
    const { result } = setup()
    act(() => result.current.setSearch("  baut  "))
    expect(result.current.search).toBe("  baut  ")
    act(() => vi.advanceTimersByTime(249))
    expect(result.current.debouncedSearch).toBe("")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.debouncedSearch).toBe("baut")
  })

  it("clears the term but lets the debounce catch up", () => {
    const { result } = setup()
    act(() => result.current.setSearch("baut"))
    act(() => vi.advanceTimersByTime(250))
    act(() => result.current.clearSearch())
    expect(result.current.search).toBe("")
    act(() => vi.advanceTimersByTime(250))
    expect(result.current.debouncedSearch).toBe("")
  })

  it.each<[number, number, number]>([
    [0, 10, 1],
    [1, 10, 1],
    [10, 10, 1],
    [11, 10, 2],
    [31, 15, 3],
  ])("%i rows at %i a page make %i pages", (rows, perPage, pages) => {
    expect(setup(perPage).result.current.totalPagesOf(rows)).toBe(pages)
  })
})
