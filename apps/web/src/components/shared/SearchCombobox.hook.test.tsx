import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { byRole, click, mount, press, settle, type, unmount } from "@/test/dom"
import Modal from "./Modal"
import SearchCombobox, { messageCls } from "./SearchCombobox"

type City = { id: number; name: string }
const CITIES: City[] = [
  { id: 1, name: "Jakarta" },
  { id: 2, name: "Jayapura" },
  { id: 3, name: "Surabaya" },
]

type HarnessProps = {
  onClose?: () => void
  onPick?: (city: City | null) => void
  loading?: boolean
}

// Modal picker, local filtering.
function Harness({ onClose = () => {}, onPick = () => {}, loading = false }: HarnessProps) {
  const [value, setValue] = useState<City | null>(null)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const items = q ? CITIES.filter((c) => c.name.toLowerCase().includes(q)) : []
  return (
    <Modal title="Pilih Kota" onClose={onClose}>
      <SearchCombobox<City>
        items={loading ? [] : items}
        value={value}
        onValueChange={(c) => {
          setValue(c)
          onPick(c)
        }}
        query={query}
        onQueryChange={setQuery}
        itemKey={(c) => c.id}
        itemToString={(c) => c.name}
        aria-label="Kota"
        clearLabel="Bersihkan kota"
        inputClassName="kota-input"
        empty={<div className={messageCls}>Tidak ada hasil</div>}
        status={loading ? <div>Mencari kota…</div> : null}
      />
    </Modal>
  )
}

afterEach(unmount)

function input(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[aria-label="Kota"]')
  if (!el) throw new Error("no input")
  return el
}

const optionNames = () => byRole("option").map((o) => o.textContent)

describe("SearchCombobox", () => {
  it("stays closed until something is typed, then lists the matches", async () => {
    await mount(<Harness />)
    expect(input().getAttribute("role")).toBe("combobox")
    expect(input().className).toBe("kota-input")
    await click(input())
    expect(byRole("option")).toHaveLength(0)

    await type(input(), "ja")
    expect(optionNames()).toEqual(["Jakarta", "Jayapura"])
  })

  it("picks with ArrowDown and Enter and shows the name", async () => {
    const onPick = vi.fn()
    await mount(<Harness onPick={onPick} />)
    await type(input(), "ja")
    await press("ArrowDown")
    await press("ArrowDown")
    await press("Enter")
    expect(onPick).toHaveBeenLastCalledWith(CITIES[1])
    expect(input().value).toBe("Jayapura")
    expect(input().getAttribute("aria-expanded")).toBe("false")
  })

  it("picks on a pointer press without closing the modal", async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    await mount(<Harness onPick={onPick} onClose={onClose} />)
    await type(input(), "sura")
    const [option] = byRole("option")
    await click(option)
    expect(onPick).toHaveBeenLastCalledWith(CITIES[2])
    expect(onClose).not.toHaveBeenCalled()
    expect(byRole("dialog")).toHaveLength(1)
  })

  it("drops the pick when the text changes and keeps typed text on blur", async () => {
    const onPick = vi.fn()
    await mount(<Harness onPick={onPick} />)
    await type(input(), "sura")
    await press("ArrowDown")
    await press("Enter")
    await type(input(), "surab")
    expect(onPick).toHaveBeenLastCalledWith(null)

    await type(input(), "zz")
    await press("Escape")
    await settle(50)
    expect(input().value).toBe("zz")
  })

  it("closes the list on Escape and leaves the modal open", async () => {
    const onClose = vi.fn()
    await mount(<Harness onClose={onClose} />)
    await type(input(), "ja")
    expect(input().getAttribute("aria-expanded")).toBe("true")
    await press("Escape")
    expect(input().getAttribute("aria-expanded")).toBe("false")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("shows the Indonesian empty and loading rows", async () => {
    await mount(<Harness />)
    await type(input(), "zz")
    expect(document.body.textContent).toContain("Tidak ada hasil")

    await unmount()
    await mount(<Harness loading />)
    await type(input(), "ja")
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Mencari kota…")
    expect(document.body.textContent).not.toContain("Tidak ada hasil")
  })

  it("clears the text and the pick with the clear button", async () => {
    const onPick = vi.fn()
    await mount(<Harness onPick={onPick} />)
    await type(input(), "ja")
    const clear = document.querySelector<HTMLButtonElement>('[aria-label="Bersihkan kota"]')
    clear?.click()
    await settle()
    expect(input().value).toBe("")
    expect(onPick).toHaveBeenLastCalledWith(null)
  })
})

describe("SearchCombobox in a modal", () => {
  it("lets a second Escape close the modal once the list is shut", async () => {
    const onClose = vi.fn()
    await mount(<Harness onClose={onClose} />)
    await type(input(), "ja")
    await press("Escape")
    expect(onClose).not.toHaveBeenCalled()
    await press("Escape")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("marks a read-only field read-only and never opens", async () => {
    await mount(
      <SearchCombobox<City>
        items={CITIES}
        value={CITIES[0]}
        onValueChange={() => {}}
        query="Jakarta"
        onQueryChange={() => {}}
        itemKey={(c) => c.id}
        itemToString={(c) => c.name}
        aria-label="Kota"
        clearLabel="Bersihkan kota"
        inputClassName="kota-input"
        readOnly
        empty={null}
      />,
    )
    expect(input().readOnly).toBe(true)
    expect(document.querySelector('[aria-label="Bersihkan kota"]')).toBeNull()
    await press("ArrowDown", input())
    expect(byRole("option")).toHaveLength(0)
  })
})
