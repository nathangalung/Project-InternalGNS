import { afterEach, describe, expect, it, vi } from "vitest"
import { button, byRole, click, mount, unmount } from "@/test/dom"
import type { PoTransition } from "@/types/api"
import StatusBar from "./StatusBar"

afterEach(unmount)

const moves: PoTransition[] = [
  { to: "ON_PROGRESS", label: "Dalam Progres", requiresNote: false },
  { to: "CANCELLED", label: "Dibatalkan", requiresNote: true },
]

function mountBar(selected: PoTransition | null, onSelect = vi.fn(), transitions = moves) {
  return mount(
    <StatusBar
      status="UPLOADED"
      selected={selected}
      transitions={transitions}
      saving={false}
      onSelect={onSelect}
      onSave={() => {}}
    />,
  )
}

describe("PO StatusBar menu", () => {
  it("checks the saved status until a move is chosen", async () => {
    await mountBar(null)
    await click(button("PO Diunggah"))
    const rows = byRole("menuitemradio")
    expect(rows.map((r) => r.textContent)).toEqual(["PO Diunggah", "Dalam Progres", "Dibatalkan"])
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"])
  })

  it("checks the pending move and passes picks up", async () => {
    const onSelect = vi.fn()
    await mountBar(moves[0], onSelect)
    await click(button("Dalam Progres"))
    const rows = byRole("menuitemradio")
    expect(rows[1].getAttribute("aria-checked")).toBe("true")
    await click(rows[0])
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(byRole("menu")).toHaveLength(0)
  })

  it("locks a terminal status", async () => {
    await mountBar(null, vi.fn(), [])
    expect(button("PO Diunggah").disabled).toBe(true)
  })
})
