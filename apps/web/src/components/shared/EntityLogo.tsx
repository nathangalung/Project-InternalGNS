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
    <div
      style={{
        width: "48px",
        height: "48px",
        borderRadius: "8px",
        background: bg,
        color: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', sans-serif",
        fontWeight: 700,
        fontSize: "13px",
        letterSpacing: "0.5px",
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  )
}
