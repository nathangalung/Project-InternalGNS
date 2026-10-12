import type { MouseEvent, ReactNode } from "react"
import { storeLink } from "@/lib/store-link"
import { ui } from "@/lib/ui"

type StoreLinkProps = {
  url: string | null | undefined
  // product: Link Produk, store: the vendor's Link Toko
  kind?: "product" | "store"
  // Says Link Produk or Link Toko before the host
  labeled?: boolean
  className?: string
  // Shown when there is no link
  fallback?: ReactNode
}

// Shield clickable parent rows.
function stopClick(e: MouseEvent) {
  e.stopPropagation()
}

// Web link, new tab.
//
// Names the host. A missing or unsafe link renders the fallback.
export default function StoreLink({
  url,
  kind = "product",
  labeled = false,
  className = "",
  fallback = null,
}: StoreLinkProps) {
  const link = storeLink(url)
  if (!link) return fallback
  const anchor = (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      title={link.href}
      aria-label={
        kind === "store"
          ? `Buka toko ${link.host} di tab baru`
          : `Buka produk di ${link.host} di tab baru`
      }
      onClick={stopClick}
      className={`inline-flex max-w-full items-center gap-1 text-xs font-medium ${ui.entityLink} ${className}`}
    >
      <span className="truncate">{link.host}</span>
      <svg
        aria-hidden="true"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
    </a>
  )
  if (!labeled) return anchor
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-dark-500">
      <span className="shrink-0">{kind === "store" ? "Link Toko" : "Link Produk"}</span>
      {anchor}
    </span>
  )
}
