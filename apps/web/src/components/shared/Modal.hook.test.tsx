import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import "@/test/renderHook"
import Modal from "./Modal"
import { modalStackDepth } from "./modalStack"
import { scrollLockCount } from "./scrollLock"

let root: Root | null = null
let main: HTMLElement

// App shell with a scrolling main.
async function mount(node: ReactNode) {
  main = document.createElement("main")
  const opener = document.createElement("button")
  opener.textContent = "Buka"
  main.append(opener)
  document.body.append(main)
  opener.focus()
  const host = document.createElement("div")
  main.append(host)
  root = createRoot(host)
  await render(node)
  return opener
}

async function render(node: ReactNode) {
  await act(async () => {
    root?.render(node)
  })
}

async function press(key: string, target: EventTarget = document.activeElement ?? document) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  })
}

// Base UI moves focus on a frame.
async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32))
  })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function dialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
}

describe("Modal", () => {
  it("renders a labelled modal dialog with the legacy shell", async () => {
    await mount(
      <Modal title="Filter Klien" onClose={() => {}} footer={<button type="button">OK</button>}>
        <p>Isi</p>
      </Modal>,
    )
    const [dialog] = dialogs()
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")
    expect(title?.tagName).toBe("H2")
    expect(title?.textContent).toBe("Filter Klien")
    expect(dialog.className).toContain("w-[672px]")
    expect(document.querySelector('[data-slot="dialog-footer"]')?.textContent).toBe("OK")
  })

  it("lets a caller width override the default", async () => {
    await mount(
      <Modal title="Diskon" onClose={() => {}} className="max-w-[min(520px,92vw)]!">
        <p>Isi</p>
      </Modal>,
    )
    expect(dialogs()[0].className).toContain("max-w-[min(520px,92vw)]!")
  })

  it("closes on Escape and on the Tutup button", async () => {
    const onClose = vi.fn()
    await mount(
      <Modal title="A" onClose={onClose}>
        <p>Isi</p>
      </Modal>,
    )
    await press("Escape")
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Tutup"]')?.click()
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("lets only the topmost of two stacked modals honour Escape", async () => {
    const outer = vi.fn()
    const inner = vi.fn()
    await mount(
      <>
        <Modal title="Luar" onClose={outer}>
          <p>Luar</p>
        </Modal>
        <Modal title="Dalam" onClose={inner}>
          <p>Dalam</p>
        </Modal>
      </>,
    )
    expect(dialogs()).toHaveLength(2)
    expect(modalStackDepth()).toBe(2)
    await press("Escape", document)
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    // Inner closed by its owner: the outer one owns Escape again.
    await render(
      <Modal title="Luar" onClose={outer}>
        <p>Luar</p>
      </Modal>,
    )
    expect(modalStackDepth()).toBe(1)
    await press("Escape", document)
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it("locks main while open and restores it and the opener's focus on unmount", async () => {
    const opener = await mount(
      <Modal title="A" onClose={() => {}}>
        <input aria-label="Nama" />
      </Modal>,
    )
    expect(main.style.overflow).toBe("hidden")
    expect(scrollLockCount()).toBe(1)
    await nextFrame()
    expect(dialogs()[0].contains(document.activeElement)).toBe(true)

    await render(null)
    expect(main.style.overflow).toBe("")
    expect(scrollLockCount()).toBe(0)
    expect(modalStackDepth()).toBe(0)
    expect(document.activeElement).toBe(opener)
  })

  it("keeps focus on a child that autofocused", async () => {
    await mount(
      <Modal title="A" onClose={() => {}}>
        {/* biome-ignore lint/a11y/noAutofocus: the behaviour under test */}
        <input aria-label="Nama" autoFocus />
      </Modal>,
    )
    await nextFrame()
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Nama")
  })
})
