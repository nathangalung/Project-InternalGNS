export const LOGO_BG_PALETTE = [
  "#1E293B",
  "#334155",
  "#475569",
  "#3730A3",
  "#4338CA",
  "#0F766E",
  "#7C2D12",
]

export function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return Math.abs(h)
}

export function logoBackground(name: string): string {
  return LOGO_BG_PALETTE[hashCode(name) % LOGO_BG_PALETTE.length]
}
