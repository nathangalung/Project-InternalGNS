import { logoBackground } from "@/lib/avatar"

function initials(name: string): string {
  const parts = name
    .replace(/^PT\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

type EntityLogoProps = {
  name: string
  // Image URL; initials without one
  src?: string
}

export default function EntityLogo({ name, src }: EntityLogoProps) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-12 w-12 shrink-0 rounded-md border border-dark-200 bg-white object-cover"
      />
    )
  }
  return (
    // Background is hashed per name.
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md font-[Inter,sans-serif] text-[13px] font-bold tracking-[0.5px] text-white"
      style={{ background: logoBackground(name) }}
    >
      {initials(name)}
    </div>
  )
}
