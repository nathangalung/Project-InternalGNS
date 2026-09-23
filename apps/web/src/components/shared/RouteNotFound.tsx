import { Link } from "@tanstack/react-router"

const containerCls =
  "flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center font-[Inter,sans-serif] text-[#4A4455]"

const linkCls =
  "mt-2 rounded-md bg-primary-700 px-[22px] py-2 text-[13px] font-semibold text-white no-underline"

// Fallback for unmatched routes.
export default function RouteNotFound() {
  return (
    <div className={containerCls}>
      <h2 className="m-0 text-[18px] font-bold">Halaman tidak ditemukan</h2>
      <p className="m-0 text-[14px]">
        URL yang Anda buka tidak tersedia. Kembali ke beranda untuk melanjutkan.
      </p>
      <Link to="/" className={linkCls}>
        Kembali ke Beranda
      </Link>
    </div>
  )
}
