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
      className="ca-section"
      style={{ opacity: !isJumlahFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}
    >
      <div className="ca-section-heading">Vendor dan Harga</div>

      <div className="ca-field">
        <label className="ca-label">
          Nama Vendor <span className="ca-required">*</span>
        </label>
        <div style={{ position: "relative" }}>
          <input
            className="ca-input"
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
                <div style={{ padding: "10px 20px", ...dropdownLabelStyle(false) }}>
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
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: isActive ? 700 : 400,
                            fontSize: "12px",
                            lineHeight: "24px",
                            color: isActive ? "#630ED4" : "#4A4455",
                          }}
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

      <div className="ca-row-2">
        <div className="ca-field">
          <label className="ca-label">
            Harga Beli Satuan <span className="ca-required">*</span>
          </label>
          <input
            className="ca-input"
            type="number"
            min={0}
            placeholder="Masukkan harga beli"
            value={form.hargaBeli}
            onChange={(e) => onChange("hargaBeli", e.target.value)}
            disabled={!isVendorFilled}
            style={!isVendorFilled ? disabledStyle : undefined}
          />
        </div>
        <div className="ca-field">
          <label className="ca-label">
            Harga Jual Satuan <span className="ca-required">*</span>
          </label>
          <input
            className="ca-input"
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

      <div className="ca-select-wrapper" style={{ width: "100%", position: "relative" }}>
        <button
          type="button"
          disabled={!isVendorFilled}
          onClick={(e) => {
            e.preventDefault()
            if (isVendorFilled) toggleDropdown("historis")
          }}
          onBlur={() => setTimeout(() => closeIfMatch("historis"), 150)}
          style={{
            width: "100%",
            padding: "11px 24px",
            fontFamily: "'Inter', sans-serif",
            fontSize: "14px",
            fontWeight: 700,
            color: isVendorFilled ? "#630ED4" : "#A386D6",
            background: "transparent",
            border: isVendorFilled
              ? "1px solid rgba(99, 14, 212, 0.2)"
              : "1px solid rgba(99, 14, 212, 0.1)",
            borderRadius: "8px",
            cursor: isVendorFilled ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: !isVendorFilled ? "#F7F7F8" : "transparent",
          }}
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
            style={{ position: "absolute", right: "20px" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {historisOpen && isVendorFilled && (
          <div style={{ ...dropdownPanelStyle, zIndex: 999 }}>
            {historisOptions.length === 0 ? (
              <div style={{ padding: "10px 20px", ...dropdownLabelStyle(false) }}>
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
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontWeight: isActive ? 700 : 400,
                      fontSize: "12px",
                      lineHeight: "24px",
                      color: isActive ? "#630ED4" : "#4A4455",
                    }}
                  >
                    Rp {formatRp(h.harga)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="ca-field">
        <label className="ca-label">Profit</label>
        <div
          className="ca-input"
          style={{
            display: "flex",
            alignItems: "center",
            color: profit === 0 ? "var(--color-text-muted)" : "var(--color-text)",
            cursor: "default",
            backgroundColor: !isVendorFilled ? "#F7F7F8" : undefined,
          }}
        >
          {profit === 0 ? "Otomatis terisi" : `Rp ${formatRp(profit)} (${profitPct}%)`}
        </div>
      </div>
    </div>
  )
}
