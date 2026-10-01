// Longest edge kept, in pixels.
export const MAX_IMAGE_EDGE = 1600

// WebP quality for re-encoding.
const QUALITY = 0.85

// Light images inside the edge stay.
const KEEP_BYTES = 300 * 1024

// Size within a square edge.
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// Swap the extension for webp.
function webpName(name: string): string {
  const dot = name.lastIndexOf(".")
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`
}

// Shrink a photo before upload.
//
// A phone photo is often 4000px and several MB, and the catalog list shows
// every product image as a thumbnail. Decoding honours the EXIF rotation,
// and re-encoding drops the rest of the EXIF block, GPS included. This only
// saves bytes, so any step the browser cannot do (decode, a 2D context,
// WebP encoding) or a result that is not smaller hands back the original,
// which the upload rules then judge as usual. A GIF stays as it is, since
// redrawing it would keep only its first frame.
export async function shrinkImage(file: File): Promise<File> {
  if (file.type === "image/gif") return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    return file
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE)
    if (size.width === bitmap.width && file.size <= KEEP_BYTES) return file
    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY })
    if (blob.type !== "image/webp" || blob.size >= file.size) return file
    return new File([blob], webpName(file.name), { type: "image/webp" })
  } catch {
    return file
  } finally {
    bitmap.close()
  }
}
