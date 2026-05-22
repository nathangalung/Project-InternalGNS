import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import { dismiss, subscribe, type ToastItem, type ToastVariant } from "@/lib/toast"

const containerStyle: CSSProperties = {
  position: "fixed",
  bottom: "24px",
  right: "24px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  zIndex: 10000,
  pointerEvents: "none",
}

// Per-variant accent colors.
function accentFor(variant: ToastVariant): { bg: string; bar: string; text: string } {
  switch (variant) {
    case "success":
      return { bg: "#ECFDF5", bar: "#10B981", text: "#065F46" }
    case "error":
      return { bg: "#FEF2F2", bar: "#EF4444", text: "#7F1D1D" }
    default:
      return { bg: "#F3EEFB", bar: "#630ED4", text: "#3D1A78" }
  }
}

function toastStyle(variant: ToastVariant): CSSProperties {
  const c = accentFor(variant)
  return {
    pointerEvents: "auto",
    minWidth: "260px",
    maxWidth: "360px",
    background: c.bg,
    borderLeft: `4px solid ${c.bar}`,
    color: c.text,
    padding: "12px 14px",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
    fontFamily: "'Inter', sans-serif",
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: "18px",
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  }
}

const closeBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "2px",
  marginLeft: "auto",
  color: "inherit",
  opacity: 0.6,
  display: "flex",
  alignItems: "center",
}

// Renders active toast queue.
export default function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => subscribe(setItems), [])

  if (items.length === 0) return null

  return (
    <div style={containerStyle} aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div
          key={t.id}
          style={toastStyle(t.variant)}
          role={t.variant === "error" ? "alert" : "status"}
        >
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            style={closeBtnStyle}
            title="Tutup"
            aria-label="Tutup notifikasi"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
