import NotFoundState from "./NotFoundState"

// Fallback for unmatched routes.
export default function RouteNotFound() {
  return (
    <NotFoundState
      title="Halaman tidak ditemukan"
      description="URL yang Anda buka tidak tersedia. Kembali ke beranda untuk melanjutkan."
      backTo={{ to: "/", label: "Kembali ke Beranda" }}
      size="page"
    />
  )
}
