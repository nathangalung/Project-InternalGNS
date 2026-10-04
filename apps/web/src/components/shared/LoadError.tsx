import { ui } from "@/lib/ui"

type LoadErrorProps = {
  message: string
  onRetry: () => void
  // A retry is in flight
  retrying?: boolean
  className?: string
}

// Failed lookup with a retry.
//
// For a list inside a form or dialog, where the route error boundary would
// replace the page and its unsaved input. The button keeps focus in a
// combobox, like the add-new buttons beside it.
export default function LoadError({
  message,
  onRetry,
  retrying = false,
  className = "",
}: LoadErrorProps) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-error ${className}`}
    >
      <span>{message}</span>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRetry}
        disabled={retrying}
        className={`rounded-sm font-bold text-primary-700 underline-offset-2 hover:underline disabled:cursor-wait disabled:opacity-60 ${ui.focusRing}`}
      >
        {retrying ? "Memuat..." : "Coba Lagi"}
      </button>
    </div>
  )
}
