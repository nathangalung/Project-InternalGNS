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
import { type Crumb, listCrumb, pageCrumb } from "@/lib/nav-trail"
import { mount, settle, unmount } from "@/test/dom"
import {
  type NavTrail,
  PageNameProvider,
  useHere,
  useNavTrail,
  usePageName,
  useTrailState,
} from "./useNavTrail"

// What the open page sees.
type Seen = { here: Crumb; state: ReturnType<typeof useTrailState>; nav: NavTrail }
let seen: Seen

const fallback = [listCrumb("/products")]

function Plain() {
  seen = { here: useHere(), state: useTrailState(), nav: useNavTrail(fallback) }
  return null
}

function Named({ label }: { label: string }) {
  usePageName(label, fallback)
  return <Plain />
}

function setup(start: string) {
  const root = createRootRoute({
    component: () => (
      <PageNameProvider>
        <Outlet />
      </PageNameProvider>
    ),
  })
  const route = (path: string, label?: string) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: () => (label ? <Named label={label} /> : <Plain />),
    })
  const router = createRouter({
    routeTree: root.addChildren([
      route("/products"),
      route("/products/$id", "Produk Tali Tambat"),
      route("/quotations/$id", "Quotation Q-00012"),
      route("/vendors/$id", "Vendor Maju"),
    ]),
    history: createMemoryHistory({ initialEntries: [start] }),
  })
  return router
}

type TestRouter = ReturnType<typeof setup>

async function open(router: TestRouter) {
  await mount(<RouterProvider router={router} />)
  await act(async () => {
    await router.load()
  })
  await settle()
}

// A link from the open page.
async function follow(router: TestRouter, href: string) {
  await act(async () => {
    await router.navigate({ href, state: seen.state })
  })
  await settle()
}

const path = (router: TestRouter) => router.state.location.pathname

afterEach(unmount)

describe("useNavTrail", () => {
  it("names a list by its section and a detail by its own label", async () => {
    const router = setup("/products")
    await open(router)
    expect(seen.here).toEqual({
      href: "/products",
      path: "/products",
      label: "Katalog Produk",
      index: 0,
    })
    await follow(router, "/quotations/12")
    expect(seen.here.label).toBe("Quotation Q-00012")
  })

  it("carries the trail along links and walks back through history", async () => {
    const router = setup("/products?cari=tali")
    await open(router)
    await follow(router, "/quotations/12")
    await follow(router, "/products/7")
    await follow(router, "/vendors/2")
    expect(seen.nav.crumbs.map((c) => c.label)).toEqual([
      "Katalog Produk",
      "Quotation Q-00012",
      "Produk Tali Tambat",
    ])
    expect(seen.nav.previous.label).toBe("Produk Tali Tambat")

    await act(async () => seen.nav.back())
    await settle()
    expect(path(router)).toBe("/products/7")
    expect(router.history.location.state.__TSR_index).toBe(2)

    await act(async () => seen.nav.back())
    await settle()
    expect(path(router)).toBe("/quotations/12")
    expect(seen.nav.crumbs.map((c) => c.href)).toEqual(["/products?cari=tali"])
  })

  it("jumps back over several crumbs from the breadcrumb", async () => {
    const router = setup("/products")
    await open(router)
    await follow(router, "/quotations/12")
    await follow(router, "/products/7")
    await follow(router, "/vendors/2")
    await act(async () => seen.nav.goTo(1))
    await settle()
    expect(path(router)).toBe("/quotations/12")
    expect(router.history.location.state.__TSR_index).toBe(1)
  })

  it("does not repeat a page when the reader goes back and forth by links", async () => {
    const router = setup("/products")
    await open(router)
    await follow(router, "/quotations/12")
    await follow(router, "/products/7")
    await follow(router, "/quotations/12")
    expect(seen.nav.crumbs.map((c) => c.path)).toEqual(["/products"])
  })

  it("opens the crumb when history holds other pages in between", async () => {
    const router = setup("/products")
    await open(router)
    await follow(router, "/quotations/12")
    // A plain navigation keeps no trail but adds an entry.
    await act(async () => {
      await router.navigate({ href: "/products/7", state: { trail: seen.state.trail } })
      await router.navigate({ href: "/products/7?foto=2", state: { trail: seen.state.trail } })
    })
    await settle()
    await act(async () => seen.nav.back())
    await settle()
    expect(path(router)).toBe("/quotations/12")
    expect(router.history.location.state.__TSR_index).toBe(4)
    expect(seen.nav.crumbs.map((c) => c.path)).toEqual(["/products"])
  })

  it("passes on the crumbs a page without a trail shows", async () => {
    const router = setup("/quotations/12")
    await open(router)
    await follow(router, "/vendors/2")
    expect(seen.nav.crumbs).toEqual([
      fallback[0],
      { href: "/quotations/12", path: "/quotations/12", label: "Quotation Q-00012", index: 0 },
    ])
  })

  it("falls back to the list when opened with no trail", async () => {
    const router = setup("/vendors/2")
    await open(router)
    expect(seen.nav.crumbs).toEqual(fallback)
    expect(seen.nav.previous).toEqual(fallback[0])
    await act(async () => seen.nav.back())
    await settle()
    expect(path(router)).toBe("/products")
    expect(seen.nav.crumbs).toEqual(fallback)
  })

  it("returns along the trail after a save, or opens the page with the trail kept", async () => {
    const router = setup("/products")
    await open(router)
    await follow(router, "/quotations/12")
    await follow(router, "/products/7")
    await act(async () => seen.nav.leaveTo(pageCrumb("/quotations/12", "Quotation Q-00012")))
    await settle()
    expect(path(router)).toBe("/quotations/12")
    expect(router.history.location.state.__TSR_index).toBe(1)

    await follow(router, "/products/7")
    await act(async () => seen.nav.leaveTo(pageCrumb("/vendors/2", "Vendor Maju")))
    await settle()
    expect(path(router)).toBe("/vendors/2")
    expect(seen.nav.crumbs.map((c) => c.path)).toEqual(["/products", "/quotations/12"])
  })
})
