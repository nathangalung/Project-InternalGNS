import { useState } from "react"
import EyeIcon from "@/components/shared/EyeIcon"
import { ui } from "@/lib/ui"

type PasswordInputProps = {
  id: string
  value: string
  onChange: (next: string) => void
  // Field shell classes from the caller.
  className: string
  autoComplete: "new-password" | "current-password"
  placeholder?: string
  invalid?: boolean
  describedBy?: string
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// Password field with reveal toggle.
export default function PasswordInput({
  id,
  value,
  onChange,
  className,
  autoComplete,
  placeholder = "••••••••",
  invalid = false,
  describedBy,
}: PasswordInputProps) {
  const [shown, setShown] = useState(false)
  const toggleLabel = shown ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"
  return (
    <div className="relative">
      <input
        id={id}
        type={shown ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} pr-12`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={toggleLabel}
        aria-pressed={shown}
        title={toggleLabel}
        className={`absolute right-3 top-1/2 flex -translate-y-1/2 items-center rounded-sm p-1 text-dark-500 transition hover:text-dark-700 ${ui.focusRing}`}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon size={18} strokeWidth={1.8} />}
      </button>
    </div>
  )
}
