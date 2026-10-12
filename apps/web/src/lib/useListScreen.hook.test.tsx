import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { act } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { mount, settle, unmount } from "@/test/dom"
import { csvOf, type ListSchema, listSearchValidator, oneOf } from "./list-search"
import { type ListScreen, useListScreen, usePageWithin } from "./useListScreen"

type Filters = { status: "all" | "active"; tags: string[] }
type SortKey = "name" | "createdAt"

const DEFAULTS: Filters = { status: "all", tags: [] }

const schema: ListSchema<Filters, SortKey> = {
  filters: DEFAULTS,
  sortKeys: ["name", "createdAt"],
  readFilters: (raw) => ({
    status: oneOf(raw.status, ["active"]) ?? "all",
    tags: csvOf(raw.tags, ["a", "b"]),
  }),
  writeFilters: (f) => ({
    status: f.status === "all" ? undefined : f.status,
    tags: f.tags.length > 0 ? f.tags.join(",") : undefined,
  }),
}

// What the list sees.
let seen: ListScreen<Filters, SortKey>
// Server total the list is told.
let total: number | undefined

function List() {
  const list = useListScreen(schema, "/list")
  usePageWithin(list, total)
  seen = list
  return null
}

function setup(start: string, state?: Record<string, unknown>) {
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/list",
        validateSearch: listSearchValidator(schema),
        component: List,
      }),
      createRoute({ getParentRoute: () => root, path: "/other", component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: [start] }),
  })
  if (state) router.history.replace(start, state)
  return router
}

type TestRouter = ReturnType<typeof setup>

async function open(start: string, state?: Record<string, unknown>): Promise<TestRouter> {
  const router = setup(start, state)
  await mount(<RouterProvider router={router} />)
  await act(async () => {
    await router.load()
  })
  await settle()
  return router
}

async function run(fn: () => void) {
  await act(async () => fn())
  await settle()
}

// Past the search debounce.
const typingPause = () => settle(300)

const href = (router: TestRouter) => router.state.location.href
const index = (router: TestRouter) => router.history.location.state.__TSR_index

afterEach(async () => {
  total = undefined
  await unmount()
})

describe("useListScreen", () => {
  it("opens a plain URL in the default state", async () => {
    await open("/list")
    expect(seen).toMatchObject({
      search: "",
      debouncedSearch: "",
      filters: DEFAULTS,
      sort: null,
      currentPage: 1,
      itemsPerPage: 10,
      startIndex: 0,
      narrowed: false,
    })
  })

  it("reads its state from the URL", async () => {
    await open("/list?q=baut&page=3&per=15&status=active&tags=b&sort=name&dir=desc")
    expect(seen).toMatchObject({
      search: "baut",
      debouncedSearch: "baut",
      filters: { status: "active", tags: ["b"] },
      sort: { key: "name", dir: "desc" },
      currentPage: 3,
      itemsPerPage: 15,
      startIndex: 30,
      narrowed: true,
    })
  })

  it("reads a malformed URL as the defaults", async () => {
    await open("/list?page=abc&per=7&status=zz&tags=%5B1&sort=price&q=%7B%7D")
    expect(seen).toMatchObject({
      search: "",
      filters: DEFAULTS,
      sort: null,
      currentPage: 1,
      itemsPerPage: 10,
    })
  })

  it("writes a page in place, without a new history entry", async () => {
    const router = await open("/list")
    await run(() => seen.setCurrentPage(3))
    expect(href(router)).toBe("/list?page=3")
    expect(index(router)).toBe(0)
    expect(seen.startIndex).toBe(20)
  })

  it("keeps the trail on the history entry", async () => {
    const trail = [{ href: "/other", path: "/other", label: "Lain" }]
    const router = await open("/list", { trail })
    await run(() => seen.setCurrentPage(2))
    expect(router.state.location.state.trail).toEqual(trail)
  })

  // Mutators that reset the page.
  //
  // The new result set starts at its first page.
  it.each<[string, (s: ListScreen<Filters, SortKey>) => void]>([
    ["setSearch", (s) => s.setSearch("baut")],
    ["applyFilters", (s) => s.applyFilters({ status: "active", tags: [] })],
    ["setItemsPerPage", (s) => s.setItemsPerPage(5)],
    ["setSort", (s) => s.setSort({ key: "name", dir: "asc" })],
  ])("%s returns to page 1", async (_name, change) => {
    const router = await open("/list?page=4")
    await run(() => change(seen))
    await typingPause()
    expect(seen.currentPage).toBe(1)
    expect(router.state.location.search).not.toHaveProperty("page")
  })

  // Chip removal keeps the page.
  it.each<[string, (s: ListScreen<Filters, SortKey>) => void]>([
    ["clearSearch", (s) => s.clearSearch()],
    ["patchFilters", (s) => s.patchFilters((f) => ({ ...f, tags: [] }))],
  ])("%s keeps the current page", async (_name, change) => {
    const router = await open("/list?q=baut&tags=a&page=4")
    await run(() => change(seen))
    await typingPause()
    expect(seen.currentPage).toBe(4)
    expect(router.state.location.search).toMatchObject({ page: 4 })
  })

  it("writes a search once it settles, in place", async () => {
    const router = await open("/list?page=2")
    let writes = 0
    const stop = router.history.subscribe(() => writes++)
    await run(() => seen.setSearch("b"))
    await run(() => seen.setSearch("ba"))
    await run(() => seen.setSearch("  baut "))
    expect(seen.search).toBe("  baut ")
    expect(seen.debouncedSearch).toBe("")
    expect(href(router)).toBe("/list?page=2")

    await typingPause()
    stop()
    expect(writes).toBe(1)
    expect(href(router)).toBe("/list?q=baut")
    expect(index(router)).toBe(0)
    expect(seen.debouncedSearch).toBe("baut")
    // The typed text stays as typed.
    expect(seen.search).toBe("  baut ")
  })

  it("leaves defaults out of the URL", async () => {
    const router = await open("/list?status=active&tags=a,b&per=5&sort=name&dir=asc")
    await run(() => seen.applyFilters(DEFAULTS))
    await run(() => seen.setItemsPerPage(10))
    expect(href(router)).toBe("/list?sort=name&dir=asc")
    expect(seen.narrowed).toBe(false)
  })

  it("applies several changes made in one go", async () => {
    const router = await open("/list?q=baut&status=active&page=2")
    await run(() => {
      seen.clearSearch()
      seen.applyFilters(DEFAULTS)
    })
    expect(href(router)).toBe("/list")
    expect(seen.search).toBe("")
  })

  it("patches the filters it reads from the URL", async () => {
    await open("/list?tags=a,b")
    await run(() => seen.patchFilters((f) => ({ ...f, tags: f.tags.filter((t) => t !== "a") })))
    expect(seen.filters).toEqual({ status: "all", tags: ["b"] })
  })

  // Narrowed means the rows shown are a subset.
  it("is narrowed by a search or by filters off their defaults", async () => {
    await open("/list")
    await run(() => seen.applyFilters({ status: "active", tags: [] }))
    expect(seen.narrowed).toBe(true)
    await run(() => seen.applyFilters(DEFAULTS))
    expect(seen.narrowed).toBe(false)
    await run(() => seen.setSearch("baut"))
    expect(seen.narrowed).toBe(false)
    await typingPause()
    expect(seen.narrowed).toBe(true)
  })

  it("follows the URL when it changes from outside", async () => {
    const router = await open("/list?q=baut&page=2")
    await act(async () => {
      await router.navigate({ href: "/list?q=kabel" })
    })
    await settle()
    expect(seen.search).toBe("kabel")
    expect(seen.currentPage).toBe(1)

    // The menu opens the list in its default state.
    await act(async () => {
      await router.navigate({ href: "/list" })
    })
    await settle()
    expect(seen).toMatchObject({ search: "", debouncedSearch: "", currentPage: 1 })
  })

  it("drops a pending search when the list closes", async () => {
    const router = await open("/list")
    await run(() => seen.setSearch("baut"))
    await act(async () => {
      await router.navigate({ href: "/other" })
    })
    await typingPause()
    expect(href(router)).toBe("/other")
  })

  // Late writes do nothing.
  //
  // A mutator kept past the list, or called while the reader is already
  // leaving it, must not write list params onto the next page.
  it.each<[string, (s: ListScreen<Filters, SortKey>) => void]>([
    ["setCurrentPage", (s) => s.setCurrentPage(3)],
    ["applyFilters", (s) => s.applyFilters({ status: "active", tags: [] })],
    ["patchFilters", (s) => s.patchFilters((f) => ({ ...f, tags: ["a"] }))],
    ["setItemsPerPage", (s) => s.setItemsPerPage(5)],
    ["setSort", (s) => s.setSort({ key: "name", dir: "asc" })],
    ["clearSearch", (s) => s.clearSearch()],
    ["setSearch", (s) => s.setSearch("baut")],
  ])("%s after the list closed leaves the location alone", async (_name, change) => {
    const router = await open("/list?q=kabel")
    const list = seen
    await act(async () => {
      await router.navigate({ href: "/other" })
    })
    await run(() => change(list))
    await typingPause()
    expect(href(router)).toBe("/other")
  })

  it("writes nothing once the reader is leaving the list", async () => {
    const router = await open("/list")
    await act(async () => {
      void router.navigate({ href: "/other" })
      seen.setCurrentPage(3)
    })
    await typingPause()
    expect(href(router)).toBe("/other")
  })

  // Shrunk total moves the reader.
  //
  // Removing a chip keeps the page, so a narrower result can end before
  // it; the reader lands on the new last page, and an unknown total
  // leaves the page alone.
  it.each<[string, number | undefined, number]>([
    ["past the end moves to the last page", 20, 2],
    ["an empty result moves to page 1", 0, 1],
    ["within range stays", 45, 4],
    ["an unknown total stays", undefined, 4],
  ])("%s", async (_name, rows, want) => {
    total = rows
    await open("/list?page=4")
    expect(seen.currentPage).toBe(want)
    expect(seen.startIndex).toBe((want - 1) * 10)
  })

  it.each<[number, number, number]>([
    [0, 10, 1],
    [1, 10, 1],
    [10, 10, 1],
    [11, 10, 2],
    [31, 15, 3],
  ])("%i rows at %i a page make %i pages", async (rows, perPage, pages) => {
    await open(`/list?per=${perPage}`)
    expect(seen.totalPagesOf(rows)).toBe(pages)
  })
})
