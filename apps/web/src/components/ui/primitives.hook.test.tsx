import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"
import "@/test/renderHook"

let root: Root | null = null

// Mount into the document.
async function mount(node: ReactNode) {
  const host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(node)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function slot(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="${name}"]`)
  if (!el) throw new Error(`no ${name}`)
  return el
}

describe("ui primitives", () => {
  it("select opens a listbox in the dropdown panel with the chosen row bold", async () => {
    await mount(
      <Select defaultValue="kg" defaultOpen>
        <SelectTrigger aria-label="Satuan">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="kg">kg</SelectItem>
          <SelectItem value="pcs">pcs</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(slot("select-trigger").className).toContain("bg-dark-200")
    expect(slot("select-content").className).toContain("[box-shadow:0_4px_12px_rgba(0,0,0,0.08)]")
    expect(slot("select-content").className).not.toContain("absolute")
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    const chosen = document.querySelector<HTMLElement>('[data-slot="select-item"][data-selected]')
    expect(chosen?.textContent).toBe("kg")
  })

  it("combobox lists matching items under the field input", async () => {
    await mount(
      <Combobox items={["Jakarta", "Surabaya"]} defaultOpen>
        <ComboboxInput aria-label="Kota" />
        <ComboboxContent>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    )
    expect(slot("combobox-input").className).toContain("bg-dark-200")
    expect(document.querySelectorAll('[data-slot="combobox-item"]')).toHaveLength(2)
  })

  it("menu shows the status panel with a heading and items", async () => {
    await mount(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Ubah status</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Ubah ke</DropdownMenuLabel>
            <DropdownMenuItem>Dikirim</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(slot("dropdown-menu-content").className).toContain("w-[162px]")
    expect(document.querySelector('[role="menuitem"]')?.textContent).toBe("Dikirim")
  })

  it("popover and tooltip render their panels", async () => {
    await mount(
      <TooltipProvider>
        <Popover defaultOpen>
          <PopoverTrigger>Filter</PopoverTrigger>
          <PopoverContent>Isi</PopoverContent>
        </Popover>
        <Tooltip defaultOpen>
          <TooltipTrigger>Nilai</TooltipTrigger>
          <TooltipContent>Rp 1.000</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    expect(slot("popover-content").textContent).toBe("Isi")
    expect(slot("tooltip-content").className).toContain("bg-dark-900")
  })
})
