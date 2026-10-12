import { type DatePreset, presetRange } from "@/lib/date-range"
import type { StatusFilterValue } from "@/lib/filter-options"
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination"

// List state in the URL.
//
// Each list keeps its search, filters, page, page size and sort in its
// route's search params, so a history back, a crumb or a reload opens it
// as it was left. Reading is tolerant: a missing, unknown or malformed value
// reads as its default and never throws. Writing leaves defaults out, so a
// list in its default state has a plain URL.

// Search params as the router parsed them.
export type RawSearch = Record<string, unknown>

export type SortDir = "asc" | "desc"
export type ListSort<K extends string> = { key: K; dir: SortDir }

// Params every list shares.
export type ListSearch<K extends string = never> = {
  q?: string
  page?: number
  per?: number
  sort?: K
  dir?: SortDir
}

// One list's state.
export type ListState<F, K extends string = never> = {
  // Trimmed search term
  q: string
  page: number
  per: number
  filters: F
  sort: ListSort<K> | null
}

// How a list reads and writes its filters.
//
// writeFilters returns only the filters off their defaults.
export type ListSchema<F, K extends string = never, S extends object = object> = {
  filters: F
  // False for a list with no search box
  searchable?: boolean
  sortKeys?: readonly K[]
  // Sort with nothing picked
  sort?: ListSort<K> | null
  readFilters: (raw: RawSearch) => F
  writeFilters: (filters: F) => S
}

// Active or inactive records.
export function activeStatus(v: unknown): StatusFilterValue {
  return oneOf(v, ACTIVE_STATUSES) ?? "all"
}

export const DEFAULT_PER_PAGE = 10
const MAX_PAGE = 10_000
const SORT_DIRS: readonly SortDir[] = ["asc", "desc"]
const ACTIVE_STATUSES: readonly StatusFilterValue[] = ["active", "inactive"]
const DATE_PRESETS: readonly DatePreset[] = ["semua", "hari-ini", "7-hari", "30-hari", "kustom"]

// Trimmed text, or undefined.
//
// The router reads `?q=2026` as a number, so a number counts as text.
export function trimmed(v: unknown): string | undefined {
  let s: string | undefined
  if (typeof v === "string") s = v.trim()
  else if (typeof v === "number" && Number.isFinite(v)) s = String(v)
  return s ? s : undefined
}

// Whole number from 1 to max.
export function positiveInt(v: unknown, max = MAX_PAGE): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= max ? n : undefined
}

// One allowed value.
export function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

// Allowed values, comma separated.
//
// Unknown and repeated values drop out.
export function csvOf<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  const parts: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []
  const out: T[] = []
  for (const part of parts) {
    const value = oneOf(typeof part === "string" ? part.trim() : part, allowed)
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

// A real YYYY-MM-DD day.
export function isoDay(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined
}

// Rupiah amount as digits.
//
// Zero is no bound, as the list queries treat it.
export function amount(v: unknown): string | undefined {
  const digits = trimmed(v)?.replace(/\D/g, "").replace(/^0+/, "")
  return digits ? digits : undefined
}

// Object without undefined keys.
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

export type DateRange = { preset: DatePreset; start: string; end: string }

// Date filter from the URL.
//
// Kustom keeps its valid days and reads as semua without one. Other presets
// take today's bounds; semua carries the 30 days the filter opens on.
export function readRange(preset: unknown, from: unknown, to: unknown): DateRange {
  const p = oneOf(preset, DATE_PRESETS) ?? "semua"
  if (p === "kustom") {
    const start = isoDay(from) ?? ""
    const end = isoDay(to) ?? ""
    if (start || end) return { preset: p, start, end }
  } else if (p !== "semua") {
    return { preset: p, ...presetRange(p) }
  }
  return { preset: "semua", ...presetRange("30-hari") }
}

// Date filter for the URL.
//
// Only kustom needs its days; the other presets are recomputed on read.
export function writeRange(range: DateRange): { preset?: DatePreset; from?: string; to?: string } {
  if (range.preset === "semua") return {}
  if (range.preset !== "kustom") return { preset: range.preset }
  const from = isoDay(range.start)
  const to = isoDay(range.end)
  return from || to ? compact({ preset: range.preset, from, to }) : {}
}

// List state from a search.
export function readList<F, K extends string, S extends object>(
  schema: ListSchema<F, K, S>,
  raw: RawSearch,
): ListState<F, K> {
  const key = schema.sortKeys ? oneOf(raw.sort, schema.sortKeys) : undefined
  const per = positiveInt(raw.per)
  return {
    q: (schema.searchable !== false && trimmed(raw.q)) || "",
    page: positiveInt(raw.page) ?? 1,
    per: per !== undefined && PAGE_SIZE_OPTIONS.includes(per) ? per : DEFAULT_PER_PAGE,
    filters: schema.readFilters(raw),
    sort: key ? { key, dir: oneOf(raw.dir, SORT_DIRS) ?? "asc" } : (schema.sort ?? null),
  }
}

function sameSort<K extends string>(a: ListSort<K> | null, b: ListSort<K> | null): boolean {
  return a?.key === b?.key && a?.dir === b?.dir
}

// Search from list state.
export function writeList<F, K extends string, S extends object>(
  schema: ListSchema<F, K, S>,
  state: ListState<F, K>,
): ListSearch<K> & S {
  const sort = state.sort && !sameSort(state.sort, schema.sort ?? null) ? state.sort : undefined
  const page = Math.min(state.page, MAX_PAGE)
  return compact({
    ...schema.writeFilters(state.filters),
    q: state.q.trim() || undefined,
    sort: sort?.key,
    dir: sort?.dir,
    page: page > 1 ? page : undefined,
    per: state.per !== DEFAULT_PER_PAGE ? state.per : undefined,
  })
}

// A route's validateSearch.
//
// Returns the sparse search, defaults and malformed values left out.
export function listSearchValidator<F, K extends string, S extends object>(
  schema: ListSchema<F, K, S>,
): (raw: RawSearch) => ListSearch<K> & S {
  return (raw) => writeList(schema, readList(schema, raw))
}
