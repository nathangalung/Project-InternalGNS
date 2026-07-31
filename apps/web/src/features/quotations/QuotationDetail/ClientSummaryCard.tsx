import type { ClientInfo } from "@/features/quotations/types"

interface ClientSummaryCardProps {
  clientName: string
  clientInitials: string
  clientInfo?: ClientInfo
  shippingAlamat?: string
}

const fieldLabel = "mb-1 text-[11px] font-semibold uppercase text-[#6B7280]"
const fieldValue = "text-sm font-medium text-[#111827]"
const fieldValueSemibold = "text-sm font-semibold text-[#111827]"
const emptyValue = "text-sm font-medium italic text-[#9CA3AF]"

// Client header card.
export default function ClientSummaryCard({
  clientName,
  clientInitials,
  clientInfo,
  shippingAlamat,
}: ClientSummaryCardProps) {
  const ci = clientInfo
  return (
    <div>
      <h2 className="qe-section-title mb-3">Ringkasan Klien</h2>
      <div className="overflow-hidden rounded-lg border border-[rgba(204,195,216,0.2)] bg-white">
        <div className="flex items-center gap-4 border-b border-[rgba(204,195,216,0.15)] bg-[linear-gradient(135deg,rgba(99,14,212,0.04)_0%,rgba(99,14,212,0.01)_100%)] px-6 py-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[rgba(99,14,212,0.12)]">
            <span className="text-base font-extrabold tracking-[-0.5px] text-[#630ED4]">
              {clientInitials}
            </span>
          </div>
          <div>
            <div className="mb-1 text-base font-bold text-[#111827]">{clientName}</div>
            <span className="text-xs font-medium text-[#6B7280]">Indonesia</span>
          </div>
        </div>

        <div className="border-b border-[rgba(204,195,216,0.15)] px-6 py-5">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[1px] text-[#9CA3AF]">
            Kontak &amp; Legalitas
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-x-6 gap-y-5">
            <div>
              <div className={fieldLabel}>Narahubung</div>
              <div className={fieldValueSemibold}>{ci?.narahubung || "-"}</div>
            </div>
            <div>
              <div className={fieldLabel}>Nomor HP</div>
              <div className={fieldValue}>{ci?.phone || "-"}</div>
            </div>
            <div>
              <div className={fieldLabel}>Email Kontak</div>
              <div className={fieldValue}>{ci?.email || "-"}</div>
            </div>
            <div>
              <div className={fieldLabel}>Nomor TKU</div>
              <div className={ci?.nomorTKU ? fieldValue : emptyValue}>
                {ci?.nomorTKU || "Belum diisi"}
              </div>
            </div>
            <div>
              <div className={fieldLabel}>NPWP</div>
              <div className={ci?.npwp ? fieldValue : emptyValue}>{ci?.npwp || "Belum diisi"}</div>
            </div>
            <div>
              <div className={fieldLabel}>Reference Number</div>
              <div className={ci?.referenceNumber ? fieldValue : emptyValue}>
                {ci?.referenceNumber || "Belum diisi"}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-6 px-6 py-5">
          <div>
            <div className={fieldLabel}>Lokasi Perusahaan</div>
            <div
              className={`mt-1 text-[13px] font-medium leading-[1.6] ${
                ci?.lokasi ? "text-[#374151]" : "italic text-[#9CA3AF]"
              }`}
            >
              {ci?.lokasi || "Belum diisi"}
            </div>
          </div>
          <div>
            <div className={fieldLabel}>Alamat Pengiriman Barang</div>
            <div
              className={`mt-1 text-[13px] font-medium leading-[1.6] ${
                shippingAlamat ? "text-[#374151]" : "italic text-[#9CA3AF]"
              }`}
            >
              {shippingAlamat || "Belum diisi"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
