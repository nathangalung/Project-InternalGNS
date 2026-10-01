import { afterEach, describe, expect, it, vi } from "vitest"
import { fitWithin, MAX_IMAGE_EDGE, shrinkImage } from "./image-shrink"

describe("fitWithin", () => {
  it.each([
    ["landscape over the edge", 4000, 3000, { width: 1600, height: 1200 }],
    ["portrait over the edge", 3000, 4000, { width: 1200, height: 1600 }],
    ["already inside", 800, 600, { width: 800, height: 600 }],
    ["exactly the edge", 1600, 900, { width: 1600, height: 900 }],
    ["a sliver never rounds to zero", 10000, 2, { width: 1600, height: 1 }],
  ])("%s", (_name, w, h, want) => {
    expect(fitWithin(w, h, MAX_IMAGE_EDGE)).toEqual(want)
  })
})

type Encoded = { type: string; size: number }

// Fake decoder and canvas.
function stubCanvas(opts: {
  width: number
  height: number
  encoded?: Encoded
  decodeFails?: boolean
  noContext?: boolean
}) {
  const close = vi.fn()
  const drawImage = vi.fn()
  const convertToBlob = vi.fn(async () => {
    const e = opts.encoded ?? { type: "image/webp", size: 100 }
    return new Blob([new Uint8Array(e.size)], { type: e.type })
  })
  const sizes: [number, number][] = []
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (opts.decodeFails) throw new Error("undecodable")
      return { width: opts.width, height: opts.height, close }
    }),
  )
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(w: number, h: number) {
        sizes.push([w, h])
      }
      getContext() {
        return opts.noContext ? null : { drawImage }
      }
      convertToBlob = convertToBlob
    },
  )
  return { close, drawImage, convertToBlob, sizes }
}

const photo = (size: number, name = "foto.jpg", type = "image/jpeg") =>
  new File([new Uint8Array(size)], name, { type })

afterEach(() => vi.unstubAllGlobals())

describe("shrinkImage", () => {
  it("re-encodes a large photo as WebP within the edge", async () => {
    const c = stubCanvas({ width: 4000, height: 3000 })
    const out = await shrinkImage(photo(4_000_000, "IMG 01.JPG"))
    expect(c.sizes).toEqual([[1600, 1200]])
    expect(c.convertToBlob).toHaveBeenCalledWith({ type: "image/webp", quality: 0.85 })
    expect(out.name).toBe("IMG 01.webp")
    expect(out.type).toBe("image/webp")
    expect(out.size).toBe(100)
    expect(c.close).toHaveBeenCalled()
  })

  it("re-encodes a heavy image already inside the edge", async () => {
    const c = stubCanvas({ width: 1200, height: 900 })
    const out = await shrinkImage(photo(2_000_000, "scan.png", "image/png"))
    expect(c.sizes).toEqual([[1200, 900]])
    expect(out.name).toBe("scan.webp")
  })

  it("keeps a light image inside the edge", async () => {
    const c = stubCanvas({ width: 800, height: 600 })
    const file = photo(200_000)
    expect(await shrinkImage(file)).toBe(file)
    expect(c.convertToBlob).not.toHaveBeenCalled()
    expect(c.close).toHaveBeenCalled()
  })

  it("keeps a GIF so its animation survives", async () => {
    const c = stubCanvas({ width: 4000, height: 3000 })
    const file = photo(4_000_000, "spin.gif", "image/gif")
    expect(await shrinkImage(file)).toBe(file)
    expect(c.sizes).toEqual([])
  })

  it.each<[string, Parameters<typeof stubCanvas>[0]]>([
    ["the browser cannot decode it", { width: 0, height: 0, decodeFails: true }],
    ["there is no 2D context", { width: 4000, height: 3000, noContext: true }],
    [
      "the browser cannot encode WebP",
      { width: 4000, height: 3000, encoded: { type: "image/png", size: 100 } },
    ],
    [
      "the result is not smaller",
      { width: 4000, height: 3000, encoded: { type: "image/webp", size: 5_000_000 } },
    ],
  ])("keeps the original when %s", async (_name, opts) => {
    stubCanvas(opts)
    const file = photo(4_000_000)
    expect(await shrinkImage(file)).toBe(file)
  })

  it("keeps the original when encoding throws", async () => {
    const c = stubCanvas({ width: 4000, height: 3000 })
    c.convertToBlob.mockRejectedValueOnce(new Error("encoder crashed"))
    const file = photo(4_000_000)
    expect(await shrinkImage(file)).toBe(file)
    expect(c.close).toHaveBeenCalled()
  })

  it("names a file without an extension", async () => {
    stubCanvas({ width: 4000, height: 3000 })
    expect((await shrinkImage(photo(4_000_000, "kamera"))).name).toBe("kamera.webp")
  })
})
