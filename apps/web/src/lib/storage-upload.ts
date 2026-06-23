import { uploadAsset } from "@/lib/api-client"

// Uploads a file to the API asset proxy path returned by a presign call.
// The API streams it to MinIO over the internal network (no public S3 host).
export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  return uploadAsset(uploadUrl, file)
}
