const PALETTE = ["#1E293B", "#334155", "#475569", "#3730A3", "#4338CA", "#0F766E", "#7C2D12"]

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return Math.abs(h)
}

function initials(name: string): string {
  const parts = name.replace(/^PT\.?\s+/i, "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function EntityLogo({ name }: { name: string }) {
  const bg = PALETTE[hashCode(name) % PALETTE.length]
  return (
    <div style={{
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
    }}>
      {initials(name)}
    </div>
  )
}
