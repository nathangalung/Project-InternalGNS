import { useEffect, useState } from "react"
import { fetchObjectUrl } from "@/lib/api-client"

export type ObjectUrlState = { url: string; failed: boolean }

// Blob URL for stored object.
//
// Objects come through the authenticated API proxy, and the enforced CSP
// allows images only from self, blob: and data: and frames only from blob:,
// so an object is fetched with the session and shown as a blob URL. Empty
// while loading, without a path, or when the download fails. Every
// URL is revoked once the path moves on or the caller unmounts, including one
// that lands after that.
export function useObjectUrl(path: string | undefined): string {
  return useObjectUrlState(path).url
}

// Blob URL and failure flag.
//
// For a caller that tells a failed download from one still loading.
export function useObjectUrlState(path: string | undefined): ObjectUrlState {
  const [loaded, setLoaded] = useState<{ path: string; url: string; failed: boolean } | null>(null)

  useEffect(() => {
    if (!path) return
    let active = true
    let url = ""
    fetchObjectUrl(path)
      .then((u) => {
        url = u
        if (active) setLoaded({ path, url: u, failed: false })
        else URL.revokeObjectURL(u)
      })
      .catch(() => {
        if (active) setLoaded({ path, url: "", failed: true })
      })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  if (!path || loaded?.path !== path) return { url: "", failed: false }
  return { url: loaded.url, failed: loaded.failed }
}
