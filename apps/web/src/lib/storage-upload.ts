import { ApiError, uploadAsset } from "@/lib/api-client"
import type { PresignUpload } from "@/types/api"

// Presign, upload, retry a clash.
//
// The upload goes to the API asset path the presign returns; the API streams
// it to MinIO over the internal network (no public S3 host).
// The proxy refuses a PUT to an existing key with 409. Keys carry a
// per-second stamp, so after a short wait a fresh presign gets a new one.
// Resolves to the uploaded object key.
export async function uploadWithFreshKey(
  presign: () => Promise<PresignUpload>,
  file: File,
  retryDelayMs = 1000,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const { uploadUrl, objectKey } = await presign()
    try {
      await uploadAsset(uploadUrl, file)
      return objectKey
    } catch (err) {
      if (attempt > 0 || !(err instanceof ApiError) || err.status !== 409) throw err
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
}
