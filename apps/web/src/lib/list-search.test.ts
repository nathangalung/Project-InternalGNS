import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  amount,
  compact,
  csvOf,
  isoDay,
  type ListSchema,
  listSearchValidator,
  oneOf,
  positiveInt,
  readList,
  readRange,
  trimmed,
  writeList,
  writeRange,
} from "./list-search"

type Filters = { status: "all" | "active" | "inactive"; tags: string[] }
type SortKey = "name" | "createdAt"

const schema: ListSchema<Filters, SortKey> = {
  filters: { status: "all", tags: [] },
  sortKeys: ["name", "createdAt"],
  sort: { key: "createdAt", dir: "desc" },
  readFilters: (raw) => ({
    status: oneOf(raw.status, ["active", "inactive"]) ?? "all",
    tags: csvOf(raw.tags, ["a", "b", "c"]),
  }),
  writeFilters: (f) => ({
    status: f.status === "all" ? undefined : f.status,
    tags: f.tags.length > 0 ? f.tags.join(",") : undefined,
  }),
}

describe("field parsers", () => {
  it.each<[unknown, string | undefined]>([
    ["  baut ", "baut"],
    ["", undefined],
    ["   ", undefined],
    [2026, "2026"],
    [true, undefined],
    [null, undefined],
    [{ a: 1 }, undefined],
    [Number.NaN, undefined],
  ])("trimmed(%j) is %j", (raw, want) => {
    expect(trimmed(raw)).toBe(want)
  })

  it.each<[unknown, number | undefined]>([
    [3, 3],
    ["3", 3],
    [" 4 ", 4],
    [0, undefined],
    [-2, undefined],
    [1.5, undefined],
    ["abc", undefined],
    ["", undefined],
    [10_001, undefined],
    [null, undefined],
  ])("positiveInt(%j) is %j", (raw, want) => {
    expect(positiveInt(raw)).toBe(want)
  })

  it("keeps only allowed values", () => {
    expect(oneOf("b", ["a", "b"])).toBe("b")
    expect(oneOf("z", ["a", "b"])).toBeUndefined()
    expect(oneOf(1, ["a", "b"])).toBeUndefined()
  })

  it.each<[unknown, string[]]>([
    ["a,b", ["a", "b"]],
    [" b , a ", ["b", "a"]],
    ["a,z,a", ["a"]],
    [
      ["c", "a", 3],
      ["c", "a"],
    ],
    ["", []],
    [5, []],
  ])("csvOf(%j) is %j", (raw, want) => {
    expect(csvOf(raw, ["a", "b", "c"])).toEqual(want)
  })

  it.each<[unknown, string | undefined]>([
    ["2026-10-12", "2026-10-12"],
    ["2026-02-30", undefined],
    ["2026-1-2", undefined],
    ["12/10/2026", undefined],
    [20261012, undefined],
  ])("isoDay(%j) is %j", (raw, want) => {
    expect(isoDay(raw)).toBe(want)
  })

  it.each<[unknown, string | undefined]>([
    ["1.500.000", "1500000"],
    [250000, "250000"],
    ["0", undefined],
    ["007", "7"],
    ["abc", undefined],
    [null, undefined],
  ])("amount(%j) is %j", (raw, want) => {
    expect(amount(raw)).toBe(want)
  })

  it("drops undefined keys", () => {
    expect(compact({ a: 1, b: undefined, c: "" })).toEqual({ a: 1, c: "" })
  })
})

describe("date range", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 10:00 WIB on 12 October 2026.
    vi.setSystemTime(new Date("2026-10-12T03:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it.each<[string, unknown, unknown, unknown, ReturnType<typeof readRange>]>([
    [
      "absent seeds 30 days",
      undefined,
      undefined,
      undefined,
      {
        preset: "semua",
        start: "2026-09-12",
        end: "2026-10-12",
      },
    ],
    [
      "a preset takes today's bounds",
      "7-hari",
      "2020-01-01",
      undefined,
      {
        preset: "7-hari",
        start: "2026-10-05",
        end: "2026-10-12",
      },
    ],
    [
      "kustom keeps its days",
      "kustom",
      "2026-01-01",
      "2026-01-31",
      {
        preset: "kustom",
        start: "2026-01-01",
        end: "2026-01-31",
      },
    ],
    [
      "kustom with one day",
      "kustom",
      "bad",
      "2026-01-31",
      {
        preset: "kustom",
        start: "",
        end: "2026-01-31",
      },
    ],
    [
      "kustom with no valid day is semua",
      "kustom",
      "x",
      "y",
      {
        preset: "semua",
        start: "2026-09-12",
        end: "2026-10-12",
      },
    ],
    [
      "an unknown preset is semua",
      "kemarin",
      undefined,
      undefined,
      {
        preset: "semua",
        start: "2026-09-12",
        end: "2026-10-12",
      },
    ],
  ])("%s", (_name, preset, from, to, want) => {
    expect(readRange(preset, from, to)).toEqual(want)
  })

  it.each<[ReturnType<typeof readRange>, ReturnType<typeof writeRange>]>([
    [{ preset: "semua", start: "2026-09-12", end: "2026-10-12" }, {}],
    [{ preset: "30-hari", start: "2026-09-12", end: "2026-10-12" }, { preset: "30-hari" }],
    [
      { preset: "kustom", start: "2026-01-01", end: "2026-01-31" },
      { preset: "kustom", from: "2026-01-01", to: "2026-01-31" },
    ],
    [
      { preset: "kustom", start: "", end: "2026-01-31" },
      { preset: "kustom", to: "2026-01-31" },
    ],
    [{ preset: "kustom", start: "", end: "" }, {}],
  ])("writes %j as %j", (range, want) => {
    expect(writeRange(range)).toEqual(want)
  })
})

describe("readList", () => {
  it("reads an empty search as the defaults", () => {
    expect(readList(schema, {})).toEqual({
      q: "",
      page: 1,
      per: 10,
      filters: { status: "all", tags: [] },
      sort: { key: "createdAt", dir: "desc" },
    })
  })

  it("reads every field", () => {
    const raw = { q: " X/2026 ", page: "3", per: 15, status: "active", tags: "b", sort: "name" }
    expect(readList(schema, { ...raw, dir: "desc" })).toEqual({
      q: "X/2026",
      page: 3,
      per: 15,
      filters: { status: "active", tags: ["b"] },
      sort: { key: "name", dir: "desc" },
    })
  })

  it("ignores malformed values", () => {
    const raw = { q: { x: 1 }, page: "abc", per: 7, status: "zz", tags: "z", sort: "price" }
    expect(readList(schema, raw)).toEqual(readList(schema, {}))
  })

  it("sorts ascending when the direction is missing or malformed", () => {
    expect(readList(schema, { sort: "name", dir: "up" }).sort).toEqual({ key: "name", dir: "asc" })
  })

  it("has no sort without sort keys", () => {
    const plain: ListSchema<Record<string, never>> = {
      filters: {},
      readFilters: () => ({}),
      writeFilters: () => ({}),
    }
    expect(readList(plain, { sort: "name", dir: "asc" }).sort).toBeNull()
  })
})

describe("writeList", () => {
  it("leaves defaults out", () => {
    expect(writeList(schema, readList(schema, {}))).toEqual({})
  })

  it("writes what is off its default", () => {
    const state = {
      q: " baut ",
      page: 2,
      per: 5,
      filters: { status: "inactive" as const, tags: ["a", "c"] },
      sort: { key: "name" as const, dir: "asc" as const },
    }
    expect(writeList(schema, state)).toEqual({
      q: "baut",
      page: 2,
      per: 5,
      sort: "name",
      dir: "asc",
      status: "inactive",
      tags: "a,c",
    })
  })

  it("writes a changed direction on the default key", () => {
    const state = {
      ...readList(schema, {}),
      sort: { key: "createdAt" as const, dir: "asc" as const },
    }
    expect(writeList(schema, state)).toEqual({ sort: "createdAt", dir: "asc" })
  })

  it("keeps the page in range", () => {
    expect(writeList(schema, { ...readList(schema, {}), page: 0 })).toEqual({})
    expect(writeList(schema, { ...readList(schema, {}), page: 20_000 })).toEqual({ page: 10_000 })
  })

  it("validates a raw search to its sparse form", () => {
    const validate = listSearchValidator(schema)
    expect(validate({ page: "2", status: "zz", extra: "x" })).toEqual({ page: 2 })
    expect(validate(writeList(schema, readList(schema, { q: "a", tags: "b,a" })))).toEqual({
      q: "a",
      tags: "b,a",
    })
  })
})
