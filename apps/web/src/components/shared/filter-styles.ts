import type { CSSProperties } from "react"

// Shared styles for filter modal chips/dropdowns.
// Visual contract: must stay byte-identical to legacy inline styles
// across ClientFilter/ProductFilter etc.

export type StatusFilterValue = "all" | "active" | "inactive"

export const STATUS_FILTER_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Nonaktif" },
]

export function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 18px",
    borderRadius: "999px",
    border: active ? "1.5px solid #630ED4" : "1px solid #E5E7EB",
    background: active ? "rgba(99, 14, 212, 0.06)" : "#FFFFFF",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 600 : 500,
    fontSize: "13px",
    color: active ? "#630ED4" : "#4A4455",
    transition: "all 0.15s",
  }
}

export const dropdownItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 20px",
  width: "100%",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
}

export function dropdownLabelStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 700 : 500,
    fontSize: "14px",
    lineHeight: "20px",
    color: active ? "#630ED4" : "#4A4455",
  }
}
