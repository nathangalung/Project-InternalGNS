import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import "./renderHook"

// DOM helpers for component tests.
//
// Mounts inside a <main>, the element the app shell scrolls, and drives
// keys, typing, and clicks through act() so Base UI state settles.

let root: Root | null = null

export async function mount(node: ReactNode): Promise<void> {
  const main = document.createElement("main")
  document.body.append(main)
  root = createRoot(main)
  await act(async () => {
    root?.render(node)
  })
}

export async function unmount(): Promise<void> {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
}

// Key press on the focused element.
export async function press(key: string, target?: Element | null): Promise<void> {
  const el = target ?? document.activeElement ?? document.body
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }))
  })
  await settle()
}

// Types into an input as React sees it.
export async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await settle()
}

// Full pointer click sequence.
export async function click(el: Element): Promise<void> {
  await act(async () => {
    const init = { bubbles: true, cancelable: true, button: 0 }
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }))
    el.dispatchEvent(new MouseEvent("mousedown", init))
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }))
    el.dispatchEvent(new MouseEvent("mouseup", init))
    el.dispatchEvent(new MouseEvent("click", init))
  })
  await settle()
}

// Let timers and frames run.
export async function settle(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

export function byRole(role: string, name?: string | RegExp): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].filter((el) => {
    if (name === undefined) return true
    const text = accessibleName(el)
    return typeof name === "string" ? text === name : name.test(text)
  })
}

// Name from labelledby, label, or text.
export function accessibleName(el: HTMLElement): string {
  const ids = el.getAttribute("aria-labelledby")
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim()
  }
  const label = el.getAttribute("aria-label")
  if (label) return label
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`)
    if (lbl) return lbl.textContent?.trim() ?? ""
  }
  return el.textContent?.trim() ?? ""
}

// Native button by its text.
export function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => accessibleName(b) === name)
  if (!found) throw new Error(`no button ${name}`)
  return found
}
