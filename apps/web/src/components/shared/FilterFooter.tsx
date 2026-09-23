import { ui } from "@/lib/ui"

type FilterFooterProps = {
  onReset: () => void
  // False greys out Hapus Filter.
  canReset: boolean
  onCancel: () => void
  onApply: () => void
  applyLabel?: string
}

const resetCls = `mr-auto rounded-sm p-0 text-[13px] font-medium underline-offset-[3px] ${ui.focusRing}`

// Filter modal footer, shared buttons.
//
// Batal and Terapkan share one height. Below 640px the reset link takes
// its own row and the two buttons split the width, so nothing is clipped at
// 320px.
export default function FilterFooter({
  onReset,
  canReset,
  onCancel,
  onApply,
  applyLabel = "Terapkan",
}: FilterFooterProps) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-3">
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        className={`${resetCls} ${
          canReset
            ? "cursor-pointer text-primary-700 underline"
            : "cursor-default text-dark-300 no-underline"
        }`}
      >
        Hapus Filter
      </button>
      <div className="flex gap-4 max-sm:w-full">
        <button type="button" className={`${ui.modalCancel} max-sm:flex-1`} onClick={onCancel}>
          Batal
        </button>
        <button type="button" className={`${ui.modalSubmit} max-sm:flex-1`} onClick={onApply}>
          {applyLabel}
        </button>
      </div>
    </div>
  )
}
