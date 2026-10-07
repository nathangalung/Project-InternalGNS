import { ui } from "@/lib/ui"

type PpnSwitchProps = {
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}

// With or without PPN.
// PPN is fixed at 12%, so the choice is only whether it applies.
export default function PpnSwitch({ on, onChange, disabled = false }: PpnSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Kenakan PPN 12%"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-[background] duration-200 ease-[ease] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${ui.focusRing} ${
        on ? "bg-primary-700" : "bg-[#CBD5E1]"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ease-[ease] motion-reduce:transition-none ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  )
}
