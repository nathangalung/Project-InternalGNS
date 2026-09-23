import { useEffect, useState } from "react"
import { dismiss, subscribe, type ToastItem, type ToastVariant } from "@/lib/toast"

// Per-variant accent colors.
const accent: Record<ToastVariant, string> = {
  success: "border-l-[#10B981] bg-[#ECFDF5] text-[#065F46]",
  error: "border-l-error bg-[#FEF2F2] text-[#7F1D1D]",
  info: "border-l-primary-700 bg-[#F3EEFB] text-[#3D1A78]",
}

const toastCls =
  "pointer-events-auto flex max-w-[360px] min-w-[260px] items-start gap-2.5 rounded-md border-l-4 px-3.5 py-3 font-[Inter,sans-serif] text-[13px] leading-[18px] font-medium [box-shadow:0_8px_24px_rgba(0,0,0,0.12)]"

const closeBtnCls =
  "ml-auto flex cursor-pointer items-center border-none bg-transparent p-0.5 text-inherit opacity-60"

// Renders active toast queue.
export default function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => subscribe(setItems), [])

  if (items.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed right-6 bottom-6 z-[10000] flex flex-col gap-2.5"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`${toastCls} ${accent[t.variant]}`}
          role={t.variant === "error" ? "alert" : "status"}
        >
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className={closeBtnCls}
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
