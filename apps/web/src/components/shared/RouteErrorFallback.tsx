interface RouteErrorFallbackProps {
  error: unknown
  reset?: () => void
}

const containerCls =
  "flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-[Inter,sans-serif] text-[#4A4455]"

const buttonCls =
  "mt-2 cursor-pointer rounded-md border border-primary-700 bg-primary-700 px-[22px] py-2 text-[13px] font-semibold text-white"

const detailCls =
  "mt-2 max-w-[520px] text-[12px] whitespace-pre-wrap text-[#7B7287] [word-break:break-word]"

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err)
  } catch {
    return "Unknown error"
  }
}

export default function RouteErrorFallback({ error, reset }: RouteErrorFallbackProps) {
  return (
    <div className={containerCls}>
      <h2 className="m-0 text-[18px] font-bold">Terjadi kesalahan</h2>
      <p className="m-0 text-[14px]">
        Halaman tidak dapat dimuat. Coba muat ulang atau hubungi administrator.
      </p>
      <pre className={detailCls}>{describe(error)}</pre>
      {reset && (
        <button type="button" onClick={reset} className={buttonCls}>
          Coba Lagi
        </button>
      )}
    </div>
  )
}
