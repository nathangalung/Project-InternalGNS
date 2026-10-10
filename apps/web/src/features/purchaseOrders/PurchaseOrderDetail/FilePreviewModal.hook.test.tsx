import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useObjectUrlState } from "@/hooks/useObjectUrl"
import { button, mount, settle, unmount } from "@/test/dom"
import { testQueryClient } from "@/test/query"
import * as api from "../api"
import FilePreviewModal from "./FilePreviewModal"

vi.mock("../api")
vi.mock("@/hooks/useObjectUrl", () => ({ useObjectUrlState: vi.fn() }))

const presign = vi.mocked(api.presignDownload)
const objectUrl = vi.mocked(useObjectUrlState)
const onDownload = vi.fn()
const onClose = vi.fn()

async function open(fileName: string) {
  await mount(
    <QueryClientProvider client={testQueryClient()}>
      <FilePreviewModal
        poId={3}
        objectKey={`po/3/${fileName}`}
        fileName={fileName}
        onDownload={onDownload}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  await settle()
}

const text = () => document.body.textContent ?? ""

// Stands in for the blob URL, which happy-dom cannot load into a frame.
const BLOB = "about:blank#po"

beforeEach(() => {
  vi.clearAllMocks()
  presign.mockResolvedValue({
    downloadUrl: "/storage/object?key=po",
    expiresAt: 1,
    fileName: "x",
  })
  objectUrl.mockReturnValue({ url: BLOB, failed: false })
})
afterEach(unmount)

describe("FilePreviewModal", () => {
  it("shows a photo of the PO as an image from its blob", async () => {
    await open("lembar.jpg")
    expect(objectUrl).toHaveBeenLastCalledWith("/storage/object?key=po")
    const img = document.querySelector("img")
    expect(img?.getAttribute("src")).toBe(BLOB)
    expect(img?.getAttribute("alt")).toBe("lembar.jpg")
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("frames a PDF from its blob and opens it in a new tab for browsers that cannot", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null)
    await open("lembar.pdf")
    const frame = document.querySelector("iframe")
    expect(frame?.getAttribute("src")).toBe(BLOB)
    expect(frame?.getAttribute("title")).toBe("lembar.pdf")
    button("Buka di Tab Baru").click()
    expect(opened).toHaveBeenCalledWith(BLOB, "_blank", "noopener")
    opened.mockRestore()
  })

  it("offers only the download for a spreadsheet, without fetching it", async () => {
    await open("lembar.xlsx")
    expect(presign).not.toHaveBeenCalled()
    expect(objectUrl).toHaveBeenLastCalledWith(undefined)
    expect(text()).toContain("Pratinjau tidak tersedia untuk berkas ini.")
    expect(document.querySelector("img, iframe")).toBeNull()
    button("Unduh Berkas").click()
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it("says it is loading until the blob lands", async () => {
    objectUrl.mockReturnValue({ url: "", failed: false })
    await open("lembar.pdf")
    expect(text()).toContain("Memuat berkas")
    expect(document.querySelector("iframe")).toBeNull()
    expect(button("Buka di Tab Baru").disabled).toBe(true)
  })

  it.each([
    ["the file", () => objectUrl.mockReturnValue({ url: "", failed: true })],
    ["its address", () => presign.mockRejectedValue(new Error("gone"))],
  ])("says so when %s fails to load and keeps the download", async (_name, fail) => {
    fail()
    await open("lembar.png")
    expect(text()).toContain("Gagal memuat berkas PO.")
    expect(document.querySelector("img")).toBeNull()
    button("Unduh Berkas").click()
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it("closes on Tutup", async () => {
    await open("lembar.pdf")
    button("Tutup").click()
    expect(onClose).toHaveBeenCalled()
  })
})
