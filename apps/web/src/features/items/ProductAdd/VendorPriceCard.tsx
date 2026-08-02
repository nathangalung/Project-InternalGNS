import { ui } from "@/lib/ui"
import {
  AddNewButton,
  CheckmarkIcon,
  type DropdownKey,
  disabledStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
  formatRp,
  type HistorisOption,
  type ProductAddFormData,
  type VendorOption,
} from "./helpers"

interface VendorPriceCardProps {
  form: ProductAddFormData
  onChange: (field: keyof ProductAddFormData, value: string) => void
  onPickVendor: (vendor: VendorOption) => void
  onPickHistoris: (harga: number) => void
  vendorMatches: VendorOption[]
  exactVendor?: VendorOption
  vendorOpen: boolean
  historisOpen: boolean
  historisOptions: HistorisOption[]
  setOpenDropdown: (key: DropdownKey | null) => void
  closeIfMatch: (key: DropdownKey) => void
  toggleDropdown: (key: DropdownKey) => void
  isJumlahFilled: boolean
  isVendorFilled: boolean
  profit: number
  profitPct: string
  onAddVendorNew: () => void
}

// Vendor and price card.
export default function VendorPriceCard({
  form,
  onChange,
  onPickVendor,
  onPickHistoris,
  vendorMatches,
  exactVendor,
  vendorOpen,
  historisOpen,
  historisOptions,
  setOpenDropdown,
  closeIfMatch,
  toggleDropdown,
  isJumlahFilled,
  isVendorFilled,
  profit,
  profitPct,
  onAddVendorNew,
}: VendorPriceCardProps) {
  return (
    <div
      className={`${ui.modalSection} transition-opacity duration-200 ease-[ease] ${
        !isJumlahFilled ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className={ui.modalSectionHeading}>Vendor dan Harga Beli</div>

      <div className={ui.field}>
        <label className={ui.fieldLabel}>
          Nama Vendor <span className="text-primary-700">*</span>
        </label>
        <div className="relative">
          <input
            className={`${ui.fieldInput} font-sans`}
            type="text"
            placeholder="Ketik atau pilih vendor"
            value={form.namaVendor}
            disabled={!isJumlahFilled}
            style={!isJumlahFilled ? disabledStyle : undefined}
            onChange={(e) => {
              onChange("namaVendor", e.target.value)
              setOpenDropdown("vendor")
            }}
            onFocus={() => {
              if (isJumlahFilled) setOpenDropdown("vendor")
            }}
            onBlur={() => setTimeout(() => closeIfMatch("vendor"), 150)}
          />
          {vendorOpen && isJumlahFilled && (
            <div style={dropdownPanelStyle}>
              {vendorMatches.length === 0 ? (
                <div className="px-5 py-2.5" style={dropdownLabelStyle(false)}>
                  Tidak ada hasil. Silahkan tambahkan vendor baru.
                </div>
              ) : (
                vendorMatches.map((v) => {
                  const isActive = exactVendor?.nama === v.nama
                  return (
                    <button
                      key={v.nama}
                      type="button"
                      style={dropdownItemStyle}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPickVendor(v)}
                    >
                      <span style={dropdownLabelStyle(isActive)}>{v.nama}</span>
                      {v.harga > 0 ? (
                        <span
                          className={`text-caption leading-6 ${
                            isActive ? "font-bold text-primary-700" : "font-normal text-[#4A4455]"
                          }`}
                        >
                          Rp {formatRp(v.harga)}
                        </span>
                      ) : isActive ? (
                        <CheckmarkIcon />
                      ) : null}
                    </button>
                  )
                })
              )}
              <AddNewButton label="Tambah Vendor Baru" onClick={onAddVendorNew} />
            </div>
          )}
        </div>
      </div>

      <div className={ui.row2}>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Harga Beli Satuan <span className="text-primary-700">*</span>
          </label>
          <input
            className={`${ui.fieldInput} font-sans`}
            type="number"
            min={0}
            placeholder="Masukkan harga beli"
            value={form.hargaBeli}
            onChange={(e) => onChange("hargaBeli", e.target.value)}
            disabled={!isVendorFilled}
            style={!isVendorFilled ? disabledStyle : undefined}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Harga Jual Satuan <span className="text-primary-700">*</span>
          </label>
          <input
            className={`${ui.fieldInput} font-sans`}
            type="number"
            min={0}
            placeholder="Masukkan harga jual"
            value={form.hargaJual}
            onChange={(e) => onChange("hargaJual", e.target.value)}
            disabled={!isVendorFilled}
            style={!isVendorFilled ? disabledStyle : undefined}
          />
        </div>
      </div>

      <div className="relative w-full">
        <button
          type="button"
          disabled={!isVendorFilled}
          onClick={(e) => {
            e.preventDefault()
            if (isVendorFilled) toggleDropdown("historis")
          }}
          onBlur={() => setTimeout(() => closeIfMatch("historis"), 150)}
          className={`flex w-full items-center justify-center rounded-md border px-6 py-[11px] text-sm font-bold ${
            isVendorFilled
              ? "cursor-pointer border-[rgba(99,14,212,0.2)] bg-transparent text-primary-700"
              : "cursor-not-allowed border-[rgba(99,14,212,0.1)] bg-[#F7F7F8] text-[#A386D6]"
          }`}
        >
          <span>Historis Harga Jual</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="absolute right-5"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {historisOpen && isVendorFilled && (
          <div style={{ ...dropdownPanelStyle, zIndex: 999 }}>
            {historisOptions.length === 0 ? (
              <div className="px-5 py-2.5" style={dropdownLabelStyle(false)}>
                Belum ada riwayat harga.
              </div>
            ) : null}
            {historisOptions.map((h, i) => {
              const isActive = form.hargaJual === String(h.harga)
              return (
                <button
                  key={i}
                  type="button"
                  style={dropdownItemStyle}
                  onClick={(e) => {
                    e.preventDefault()
                    onPickHistoris(h.harga)
                  }}
                >
                  <span style={dropdownLabelStyle(isActive)}>{h.keterangan}</span>
                  <span
                    className={`text-caption leading-6 ${
                      isActive ? "font-bold text-primary-700" : "font-normal text-[#4A4455]"
                    }`}
                  >
                    Rp {formatRp(h.harga)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className={ui.field}>
        <label className={ui.fieldLabel}>Profit</label>
        <div
          className={`${ui.fieldInput} flex cursor-default items-center ${
            profit === 0 ? "text-dark-500" : "text-dark-900"
          } ${!isVendorFilled ? "bg-[#F7F7F8]" : ""}`}
        >
          {profit === 0 ? "Otomatis terisi" : `Rp ${formatRp(profit)} (${profitPct}%)`}
        </div>
      </div>
    </div>
  )
}
