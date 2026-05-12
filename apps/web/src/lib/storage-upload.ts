// Raw PUT against a MinIO presigned URL. Used by every asset-upload flow
// (PO docs, client/vendor logos, item images, invoice attachments).
export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`upload failed: ${res.status} ${text}`)
  }
}
