type LoadingStateProps = {
  // e.g. "Memuat data klien…"
  label?: string
}

// Route-level loading placeholder.
//
// The spinner only turns when motion is allowed; the label always shows, and
// role=status announces it once.
export default function LoadingState({ label = "Memuat data…" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] items-center justify-center gap-3 p-8 text-sm text-dark-500"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 rounded-full border-2 border-dark-200 border-t-primary-600 motion-safe:animate-spin"
      />
      {label}
    </div>
  )
}
