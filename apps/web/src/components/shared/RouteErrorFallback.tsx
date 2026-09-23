import { ui } from "@/lib/ui"
import { errorCopy } from "./errorDetail"
import StateMessage from "./StateMessage"

type RouteErrorFallbackProps = {
  error: unknown
  reset?: () => void
}

// Route error, no raw 5xx text.
export default function RouteErrorFallback({ error, reset }: RouteErrorFallbackProps) {
  const { message, detail } = errorCopy(error, import.meta.env.DEV)
  return (
    <StateMessage
      title="Terjadi kesalahan"
      size="page"
      action={
        reset && (
          <button type="button" onClick={reset} className={ui.btnPrimary}>
            Coba Lagi
          </button>
        )
      }
    >
      <p>{message}</p>
      {detail && (
        <p className="mt-2 text-xs whitespace-pre-wrap text-dark-500 [word-break:break-word]">
          {detail}
        </p>
      )}
    </StateMessage>
  )
}
