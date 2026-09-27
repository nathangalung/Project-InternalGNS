import { afterEach, describe, expect, it, vi } from "vitest"
import { button, byRole, click, mount, press, unmount } from "@/test/dom"
import type { QuotationTransition } from "@/types/api"
import StatusBar from "./StatusBar"

afterEach(unmount)

const moves: QuotationTransition[] = [
  { to: "accepted", label: "Disetujui", requiresNote: false },
  { to: "rejected", label: "Ditolak", requiresNote: true },
]

function mountBar(props: { moves?: QuotationTransition[]; onPick?: () => void } = {}) {
  return mount(
    <StatusBar
      status="Dikirim"
      hint="Pilih status berikutnya."
      moves={props.moves ?? moves}
      canRevise={false}
      onPick={props.onPick ?? (() => {})}
      onRevise={() => {}}
    />,
  )
}

describe("quotation StatusBar menu", () => {
  it("lists the allowed moves under Ubah ke", async () => {
    await mountBar()
    await click(button("Status Dikirim, ubah status"))
    const [menu] = byRole("menu")
    expect(menu.textContent).toContain("Ubah ke")
    expect(byRole("menuitem").map((m) => m.textContent)).toEqual(["Disetujui", "Ditolak"])
  })

  it("hands the picked move to onPick from the keyboard", async () => {
    let focusedAtPick: Element | null = null
    const onPick = vi.fn(() => {
      focusedAtPick = document.activeElement
    })
    await mountBar({ onPick })
    button("Status Dikirim, ubah status").focus()
    await press("ArrowDown")
    await press("ArrowDown")
    await press("Enter")
    expect(onPick).toHaveBeenCalledWith(moves[1])
    expect(byRole("menu")).toHaveLength(0)
    // The dialog records the badge as its opener
    expect(focusedAtPick).toBe(button("Status Dikirim, ubah status"))
  })

  it("disables the badge when no move is allowed", async () => {
    await mountBar({ moves: [] })
    expect(button("Status Dikirim").disabled).toBe(true)
  })
})
