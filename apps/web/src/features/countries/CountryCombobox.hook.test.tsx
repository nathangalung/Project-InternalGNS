import { QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import Modal from "@/components/shared/Modal"
import { queryKeys } from "@/lib/query-keys"
import { byRole, click, mount, press, type, unmount } from "@/test/dom"
import { testQueryClient } from "@/test/query"
import type { CountryRow } from "@/types/api"
import CountryCombobox from "./CountryCombobox"

const COUNTRIES: CountryRow[] = [
  { code: "IDN", name: "Indonesia", dialCode: "+62" },
  { code: "IND", name: "India", dialCode: "+91" },
  { code: "SGP", name: "Singapore", dialCode: "+65" },
]

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [code, setCode] = useState("IDN")
  return (
    <Modal title="Tambah Klien" onClose={onClose}>
      <label htmlFor="negara">Kode Negara</label>
      <CountryCombobox
        code={code}
        onCodeChange={setCode}
        triggerId="negara"
        triggerClassName="negara-trigger"
        fallback="Pilih Negara"
      />
      <output>{code}</output>
    </Modal>
  )
}

async function mountHarness(onClose?: () => void) {
  const qc = testQueryClient()
  qc.setQueryData(queryKeys.countries.list(), COUNTRIES)
  await mount(
    <QueryClientProvider client={qc}>
      <Harness onClose={onClose} />
    </QueryClientProvider>,
  )
}

afterEach(unmount)

function trigger(): HTMLElement {
  const el = document.getElementById("negara")
  if (!el) throw new Error("no trigger")
  return el
}

function search(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[aria-label="Cari negara"]')
  if (!el) throw new Error("no search input")
  return el
}

describe("CountryCombobox", () => {
  it("shows the picked country on the trigger and opens a searchable list", async () => {
    await mountHarness()
    expect(trigger().textContent).toBe("IDN - Indonesia")
    await click(trigger())
    expect(byRole("option").map((o) => o.textContent)).toEqual([
      "IDN - Indonesia",
      "IND - India",
      "SGP - Singapore",
    ])
    expect(byRole("option")[0].hasAttribute("data-selected")).toBe(true)
  })

  it("filters on name or code and picks from the keyboard", async () => {
    await mountHarness()
    await click(trigger())
    await type(search(), "sgp")
    expect(byRole("option").map((o) => o.textContent)).toEqual(["SGP - Singapore"])
    await press("ArrowDown", search())
    await press("Enter", search())
    expect(document.querySelector("output")?.textContent).toBe("SGP")
    expect(trigger().textContent).toBe("SGP - Singapore")
  })

  it("shows the Indonesian empty row and keeps the modal on Escape", async () => {
    const onClose = vi.fn()
    await mountHarness(onClose)
    await click(trigger())
    await type(search(), "zz")
    expect(document.body.textContent).toContain("Tidak ada hasil")
    await press("Escape", search())
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe("CountryCombobox Escape", () => {
  it("returns focus to the trigger so a second Escape closes the modal", async () => {
    const onClose = vi.fn()
    await mountHarness(onClose)
    await click(trigger())
    await press("Escape", search())
    expect(onClose).not.toHaveBeenCalled()
    await press("Escape")
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
