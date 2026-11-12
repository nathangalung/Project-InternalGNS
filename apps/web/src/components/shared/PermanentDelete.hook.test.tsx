import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { button, click, mount, unmount } from "@/test/dom"
import { problem } from "@/test/problem"
import PermanentDelete from "./PermanentDelete"

const HINT = "Untuk menonaktifkan, matikan Status Klien di halaman ini, lalu Simpan."

async function open(onDelete: () => Promise<unknown>) {
  await mount(
    <PermanentDelete
      noun="klien"
      name="PT Laut"
      along="narahubungnya"
      onDelete={onDelete}
      deactivateHint={HINT}
    />,
  )
  await click(button("Hapus Permanen"))
}

// The dialog's own delete button
function confirmButton(): HTMLButtonElement {
  const all = [...document.querySelectorAll("button")].filter(
    (b) => b.textContent === "Hapus Permanen",
  )
  const last = all[all.length - 1]
  if (!last) throw new Error("no confirm button")
  return last
}

function alertText(): string {
  return document.querySelector("[role=alert]")?.textContent ?? ""
}

afterEach(unmount)

describe("PermanentDelete", () => {
  it("points a used record to deactivation", async () => {
    const used = new ApiError(
      409,
      problem(409, {
        code: "in_use",
        detail: "Klien ini sudah dipakai di 1 quotation. Nonaktifkan saja.",
      }),
      "Klien ini sudah dipakai di 1 quotation. Nonaktifkan saja.",
    )
    await open(vi.fn(async () => Promise.reject(used)))
    await click(confirmButton())
    expect(alertText()).toContain("Klien ini sudah dipakai di 1 quotation. Nonaktifkan saja.")
    expect(alertText()).toContain(HINT)
  })

  it("shows any other failure without the hint", async () => {
    await open(vi.fn(async () => Promise.reject(new ApiError(500, null, "Gagal menghapus klien."))))
    await click(confirmButton())
    expect(alertText()).toBe("Gagal menghapus klien.")
  })
})
