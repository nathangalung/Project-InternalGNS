import { useEffect, useState } from "react"
import { fetchObjectUrl } from "@/lib/api-client"

// Blob URL for a stored object.
//
// Objects come through the authenticated API proxy, and the enforced CSP
// allows images only from self, blob: and data:, so an image is fetched with
// the session and shown as a blob URL. Empty while loading, without a path,
// or when the download fails. Every URL is revoked once the path moves on or
// the caller unmounts, including one that lands after that.
export function useObjectUrl(path: string | undefined): string {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let active = true
    let url = ""
    fetchObjectUrl(path)
      .then((u) => {
        url = u
        if (active) setLoaded({ path, url: u })
        else URL.revokeObjectURL(u)
      })
      .catch(() => {})
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  return path && loaded?.path === path ? loaded.url : ""
}
