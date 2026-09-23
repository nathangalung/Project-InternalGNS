// Failed summary notice.
//
// Without it the figures stay "–" and the tiles never appear, with nothing
// saying why.
export default function SummaryError({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <p
      role="alert"
      className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-red-800"
    >
      Gagal memuat ringkasan dashboard. Muat ulang halaman untuk mencoba lagi.
    </p>
  )
}
