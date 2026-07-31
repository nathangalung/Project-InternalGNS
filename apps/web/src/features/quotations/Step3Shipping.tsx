import type { CSSProperties } from "react"
import { qe, qep } from "./wizard-styles"

interface Step3ShippingProps {
  shippingAddress: string
  setShippingAddress: (s: string) => void
  shippingTime: string
  setShippingTime: (s: string) => void
  shippingCost: string
  setShippingCost: (s: string) => void
  isAlamatFilled: boolean
  isWaktuFilled: boolean
  // Accepted for legacy callers; the disabled look now comes from utilities.
  disabledStyle?: CSSProperties
  formatRp: (n: number) => string
}

const fieldLabel = "mb-2 block text-[11px] font-bold uppercase tracking-[0.5px] text-[#4B5563]"
const fieldInput =
  "box-border w-full rounded-md bg-dark-200 p-4 text-sm text-[#111827] outline-none disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60"

export default function Step3Shipping({
  shippingAddress,
  setShippingAddress,
  shippingTime,
  setShippingTime,
  shippingCost,
  setShippingCost,
  isAlamatFilled,
  isWaktuFilled,
  formatRp,
}: Step3ShippingProps) {
  const addressError =
    shippingAddress.trim().length > 0 &&
    (shippingAddress.trim().length < 20 || !/[a-zA-Z]/.test(shippingAddress))
      ? "Alamat harus minimal 20 karakter dan mengandung huruf."
      : null

  return (
    <div className={qe.stepContent}>
      <div className={qe.sectionHeader}>
        <div>
          <h2 className={qe.sectionTitle}>Detail Pengiriman</h2>
          <p className={qe.sectionDesc}>Isi informasi pengiriman barang ke klien.</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <label className={fieldLabel}>
            Alamat Lengkap <span className="text-error">*</span>
          </label>
          <textarea
            placeholder="Masukkan alamat pengiriman secara detail (min. 20 karakter)..."
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            className={`${fieldInput} min-h-[100px] resize-y`}
          />
          {addressError && <span className="mt-1 block text-xs text-error">{addressError}</span>}
        </div>

        <div className={`transition-opacity duration-200 ${isAlamatFilled ? "" : "opacity-60"}`}>
          <label className={fieldLabel}>
            Waktu Pengiriman (Hari) <span className="text-error">*</span>
          </label>
          <input
            type="number"
            min={1}
            placeholder="Masukkan jumlah hari kerja setelah PO diterima..."
            value={shippingTime}
            onChange={(e) => setShippingTime(e.target.value)}
            disabled={!isAlamatFilled}
            className={fieldInput}
          />
        </div>

        <div className={`transition-opacity duration-200 ${isWaktuFilled ? "" : "opacity-60"}`}>
          <label className={fieldLabel}>
            Biaya Pengiriman <span className="text-error">*</span>
          </label>
          <input
            type="number"
            placeholder="3570000 (Isi hanya dengan angka)"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            disabled={!isWaktuFilled}
            className={fieldInput}
          />
        </div>
      </div>

      <div className={qep.summaryCard}>
        <h3 className={qep.summaryTitle}>Ringkasan Pengiriman</h3>
        <div className={qep.summaryRow}>
          <span className="text-[0.6875rem] font-medium tracking-[0.06em] text-dark-500">
            Biaya Pengiriman
          </span>
          <span className="text-base font-bold leading-6 tracking-tight text-[#111827]">
            Rp {formatRp(Number(shippingCost) || 0)}
          </span>
        </div>
        <div className={qep.summaryRow}>
          <span className={qep.summaryLabel}>TOTAL PENGIRIMAN</span>
          <span className={qep.summaryValueGrand}>Rp {formatRp(Number(shippingCost) || 0)}</span>
        </div>
      </div>
    </div>
  )
}
