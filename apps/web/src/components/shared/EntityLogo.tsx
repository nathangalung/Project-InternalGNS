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

export default function EntityLogo({ name }: { name: string }) {
  const bg = logoBackground(name)
  return (
    // Background is hashed per name.
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md font-[Inter,sans-serif] text-[13px] font-bold tracking-[0.5px] text-white"
      style={{ background: bg }}
    >
      {initials(name)}
    </div>
  )
}
