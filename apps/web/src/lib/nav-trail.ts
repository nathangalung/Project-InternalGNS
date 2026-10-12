import { type Section, sectionFromPathname } from "@/lib/rbac"

// Navigation trail.
//
// A link into a detail or edit page carries the pages the reader came
// through in router history state, so the page shows them as a breadcrumb
// and Kembali goes back along them instead of to a list. History state
// lives on the browser history entry: it survives a reload of that entry,
// and a new tab, a bookmark or the menu start with no trail.

// One page on the trail.
export type Crumb = {
  // Path plus search, so filters in the URL come back
  href: string
  path: string
  label: string
  // History index of the entry the link left
  index?: number
}

// The trail a link carries.
//
// Module augmentation needs an interface; TanStack types history state this
// way.
declare module "@tanstack/react-router" {
  interface HistoryState {
    trail?: Crumb[]
  }
}

// Crumbs kept before the page.
export const TRAIL_CAP = 5

// Page names by section.
const SECTION_LABEL: Record<Section, string> = {
  dashboard: "Dashboard",
  "dashboard-financial": "Dashboard Finansial",
  "dashboard-operational": "Dashboard Operasional",
  quotation: "Daftar Quotation",
  "purchase-orders": "Daftar Purchase Order",
  invoices: "Daftar Invoice",
  "cash-entries": "Kas Lain",
  products: "Katalog Produk",
  vendors: "Daftar Vendor",
  clients: "Daftar Klien",
  users: "Manajemen Pengguna",
}

// Name of a page without its own.
//
// Lists and dashboards name no record, so their section names them.
export function pageLabel(pathname: string): string {
  return SECTION_LABEL[sectionFromPathname(pathname)]
}

// A page as a crumb.
export function pageCrumb(path: string, label: string): Crumb {
  return { href: path, path, label }
}

// The list a detail page falls back to.
export function listCrumb(path: string): Crumb {
  return pageCrumb(path, pageLabel(path))
}

// A same-origin href on its own path.
function hrefOnPath(href: string, path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || !href.startsWith(path)) return false
  const rest = href.slice(path.length)
  return rest === "" || rest.startsWith("?") || rest.startsWith("#")
}

// One stored crumb, or null.
//
// History state can hold anything an older build or another script left,
// so only a well formed crumb on this origin is kept.
function toCrumb(raw: unknown): Crumb | null {
  if (typeof raw !== "object" || raw === null) return null
  const { href, path, label, index } = raw as Record<string, unknown>
  if (typeof href !== "string" || typeof path !== "string" || typeof label !== "string") {
    return null
  }
  if (label.trim() === "" || !hrefOnPath(href, path)) return null
  if (index === undefined) return { href, path, label }
  return Number.isInteger(index) ? { href, path, label, index: index as number } : null
}

// The trail behind the current page.
//
// A link back to a page already on the trail cuts the trail there, so going
// back and forth adds nothing, and only the newest TRAIL_CAP crumbs stay.
export function readTrail(state: unknown, currentPath: string): Crumb[] {
  const raw = (state as { trail?: unknown } | null | undefined)?.trail
  if (!Array.isArray(raw)) return []
  const trail = raw.map(toCrumb).filter((c): c is Crumb => c !== null)
  const self = trail.findIndex((c) => c.path === currentPath)
  return (self === -1 ? trail : trail.slice(0, self)).slice(-TRAIL_CAP)
}

// The trail a link leaves with.
//
// The page being left goes last, replacing a crumb for the same page.
export function pushTrail(trail: Crumb[], here: Crumb): Crumb[] {
  const before = trail[trail.length - 1]?.path === here.path ? trail.slice(0, -1) : trail
  return [...before, here].slice(-TRAIL_CAP)
}

// History steps back to a crumb, or null.
//
// A real history back keeps the page as it was left. It is only safe when
// every crumb from the target on was left one entry after the other, the
// last right before the current entry; otherwise the entries in between are
// pages the trail does not show.
export function historyDelta(
  trail: Crumb[],
  at: number,
  currentIndex: number | undefined,
): number | null {
  if (currentIndex === undefined || at < 0 || at >= trail.length) return null
  for (let i = at; i < trail.length; i++) {
    if (trail[i].index !== currentIndex - (trail.length - i)) return null
  }
  return at - trail.length
}

export type CrumbTarget =
  | { kind: "history"; delta: number }
  | { kind: "open"; href: string; trail: Crumb[] }

// How to reach a crumb.
export function crumbTarget(
  trail: Crumb[],
  at: number,
  currentIndex: number | undefined,
): CrumbTarget {
  const delta = historyDelta(trail, at, currentIndex)
  if (delta !== null) return { kind: "history", delta }
  return { kind: "open", href: trail[at].href, trail: trail.slice(0, at) }
}
