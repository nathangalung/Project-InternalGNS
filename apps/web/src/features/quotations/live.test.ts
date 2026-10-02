import { describe, expect, it } from "vitest"
import type { QuotationDetail, QuotationEditLock } from "@/types/api"
import { HEADER_PART, headerInput, linePart, lockOwners, nextExpiry, saveDraft } from "./live"

const lock = (part: string, userId: number, userName: string, expiresAt = "2026-10-01T10:00:00Z") =>
  ({ part, userId, userName, expiresAt }) satisfies QuotationEditLock

describe("linePart", () => {
  it("names a line part", () => {
    expect(linePart(12)).toBe("line:12")
  })
})

describe("lockOwners", () => {
  it.each([
    { name: "no claims", locks: [], want: { lines: {} } },
    {
      name: "others' lines and header",
      locks: [lock("line:3", 2, "Budi"), lock(HEADER_PART, 3, "Sari"), lock("line:9", 3, "Sari")],
      want: { lines: { 3: "Budi", 9: "Sari" }, header: "Sari" },
    },
    {
      name: "own claims stay editable",
      locks: [lock("line:3", 1, "Saya"), lock(HEADER_PART, 1, "Saya")],
      want: { lines: {} },
    },
    {
      name: "unknown parts are ignored",
      locks: [lock("line:x", 2, "Budi"), lock("other", 2, "Budi")],
      want: { lines: {} },
    },
  ])("$name", ({ locks, want }) => {
    expect(lockOwners(locks, 1)).toEqual(want)
  })
})

describe("nextExpiry", () => {
  it("picks the earliest claim of another user", () => {
    const locks = [
      lock("line:1", 2, "Budi", "2026-10-01T10:02:00Z"),
      lock("line:2", 1, "Saya", "2026-10-01T10:00:00Z"),
      lock("line:3", 3, "Sari", "2026-10-01T10:01:00Z"),
      lock("line:4", 3, "Sari", "bukan tanggal"),
    ]
    expect(nextExpiry(locks, 1)).toBe(Date.parse("2026-10-01T10:01:00Z"))
  })

  it("is undefined without other claims", () => {
    expect(nextExpiry([lock("line:2", 1, "Saya")], 1)).toBeUndefined()
  })
})

describe("headerInput", () => {
  const detail = {
    clientRefNo: "REF-1",
    vesselName: "MV Laut",
    notes: "Catatan",
  } as QuotationDetail
  const fields = {
    discountPct: 2.5,
    shippingAddress: "Pelabuhan Tanjung Priok",
    shippingTime: "3",
    shippingCost: "150000",
    jatuhTempo: " 30 ",
    berlakuSampai: "14",
  }

  it("sends every header field", () => {
    expect(headerInput(detail, fields)).toEqual({
      clientRefNo: "REF-1",
      vesselName: "MV Laut",
      notes: "Catatan",
      paymentTerms: "30 days",
      validityDays: 14,
      discountPct: "2.5",
      shippingAddress: "Pelabuhan Tanjung Priok",
      shippingDays: 3,
      shippingCost: "150000",
    })
  })

  it("leaves blanks out", () => {
    const bare = { clientRefNo: null, vesselName: null, notes: null } as unknown as QuotationDetail
    expect(
      headerInput(bare, {
        discountPct: 0,
        shippingAddress: "",
        shippingTime: "",
        shippingCost: "",
        jatuhTempo: " ",
        berlakuSampai: "0",
      }),
    ).toEqual({
      clientRefNo: undefined,
      vesselName: undefined,
      notes: undefined,
      paymentTerms: undefined,
      validityDays: undefined,
      discountPct: "0",
      shippingAddress: undefined,
      shippingDays: undefined,
      shippingCost: undefined,
    })
  })
})

describe("saveDraft", () => {
  type Run = { holdsHeader: boolean; contactId?: number; grant?: boolean; fail?: string }

  // A recorded Simpan.
  async function simpan(opts: Run): Promise<{ ok: boolean; calls: string[] }> {
    const calls: string[] = []
    const step = async (name: string) => {
      calls.push(name)
      if (opts.fail === name) throw new Error(name)
    }
    const ok = await saveDraft({
      holdsHeader: opts.holdsHeader,
      contactId: opts.contactId,
      acquireHeader: async () => {
        calls.push("acquire")
        return opts.grant ?? true
      },
      releaseHeader: async () => {
        calls.push("release")
      },
      saveHeader: () => step("header"),
      saveContact: (id) => step(`contact:${id}`),
    })
    return { ok, calls }
  }

  it.each<Run & { name: string; want: string[]; ok: boolean }>([
    { name: "header only", holdsHeader: true, want: ["header"], ok: true },
    {
      name: "header, then contact",
      holdsHeader: true,
      contactId: 7,
      want: ["header", "contact:7"],
      ok: true,
    },
    {
      name: "a contact claims the header first",
      holdsHeader: false,
      contactId: 7,
      want: ["acquire", "contact:7"],
      ok: true,
    },
    { name: "nothing to save", holdsHeader: false, want: [], ok: true },
    {
      name: "a header held elsewhere stops the save",
      holdsHeader: false,
      contactId: 7,
      grant: false,
      want: ["acquire"],
      ok: false,
    },
    {
      name: "a refused contact frees the claim it took",
      holdsHeader: false,
      contactId: 7,
      fail: "contact:7",
      want: ["acquire", "contact:7", "release"],
      ok: false,
    },
    {
      name: "a refused header keeps the own claim",
      holdsHeader: true,
      contactId: 7,
      fail: "header",
      want: ["header"],
      ok: false,
    },
  ])("$name", async ({ name: _, want, ok, ...opts }) => {
    expect(await simpan(opts)).toEqual({ ok, calls: want })
  })
})
