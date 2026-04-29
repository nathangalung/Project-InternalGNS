import {
  AddNewButton,
  type CatalogItem,
  CheckmarkIcon,
  type DropdownKey,
  type ProductAddFormData,
  disabledStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
  formatKodeNama,
} from "./helpers";

interface IdentityCardProps {
  form: ProductAddFormData;
  onChange: (field: keyof ProductAddFormData, value: string) => void;
  productCatalog: CatalogItem[];
  productMatches: CatalogItem[];
  activeProductLabel?: string;
  productOpen: boolean;
  satuanOpen: boolean;
  satuanOptions: string[];
  setOpenDropdown: (key: DropdownKey | null) => void;
  closeIfMatch: (key: DropdownKey) => void;
  toggleDropdown: (key: DropdownKey) => void;
  isProductFilled: boolean;
  isSatuanFilled: boolean;
  onAddProductNew: () => void;
  onPickProduct?: (item: CatalogItem) => void;
}

// Product identity card.
export default function IdentityCard({
  form,
  onChange,
  productMatches,
  activeProductLabel,
  productOpen,
  satuanOpen,
  satuanOptions,
  setOpenDropdown,
  closeIfMatch,
  toggleDropdown,
  isProductFilled,
  isSatuanFilled,
  onAddProductNew,
  onPickProduct,
}: IdentityCardProps) {
  return (
    <div className="ca-section">
      <div className="ca-section-heading">Identitas Produk</div>

      <div className="ca-field">
        <label className="ca-label">Kode IMPA/Nama Produk <span className="ca-required">*</span></label>
        <div style={{ position: "relative" }}>
          <input
            className="ca-input"
            type="text"
            placeholder="Masukkan nama atau kode IMPA"
            value={form.kodeImpaNama}
            onChange={e => { onChange("kodeImpaNama", e.target.value); setOpenDropdown("product"); }}
            onFocus={() => setOpenDropdown("product")}
            onBlur={() => setTimeout(() => closeIfMatch("product"), 150)}
          />
          {productOpen && (
            <div style={dropdownPanelStyle}>
              {productMatches.length === 0 ? (
                <div style={{ padding: "10px 20px", ...dropdownLabelStyle(false) }}>Tidak ada hasil</div>
              ) : (
                productMatches.map(p => {
                  const label = formatKodeNama(p.kode, p.nama);
                  const isActive = label === activeProductLabel;
                  return (
                    <button
                      key={p.id ?? label}
                      type="button"
                      style={dropdownItemStyle}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        onChange("kodeImpaNama", label);
                        onPickProduct?.(p);
                        setOpenDropdown(null);
                      }}
                    >
                      <span style={dropdownLabelStyle(isActive)}>{label}</span>
                      {isActive && <CheckmarkIcon />}
                    </button>
                  );
                })
              )}
              <AddNewButton label="Tambah Produk Baru" onClick={onAddProductNew} />
            </div>
          )}
        </div>
      </div>

      <div className="ca-row-2">
        <div className="ca-field">
          <label className="ca-label">Satuan <span className="ca-required">*</span></label>
          <div className="ca-select-wrapper">
            <button
              type="button"
              className="ca-select-btn"
              onClick={() => { if (isProductFilled) toggleDropdown("satuan"); }}
              onBlur={() => setTimeout(() => closeIfMatch("satuan"), 150)}
              disabled={!isProductFilled}
              style={{
                ...(!isProductFilled ? disabledStyle : {}),
                color: !form.satuan && isProductFilled ? "var(--color-text-muted)" : undefined,
              }}
            >
              <span>{form.satuan || "Pilih satuan"}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {satuanOpen && isProductFilled && (
              <div style={dropdownPanelStyle}>
                {satuanOptions.map(opt => {
                  const isActive = form.satuan === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      style={dropdownItemStyle}
                      onClick={() => { onChange("satuan", opt); setOpenDropdown(null); }}
                    >
                      <span style={dropdownLabelStyle(isActive)}>{opt}</span>
                      {isActive && <CheckmarkIcon />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="ca-field">
          <label className="ca-label">Jumlah Produk <span className="ca-required">*</span></label>
          <input
            className="ca-input"
            type="number"
            min={1}
            placeholder="Masukkan jumlah produk"
            value={form.jumlahProduk}
            onChange={e => onChange("jumlahProduk", e.target.value)}
            disabled={!isSatuanFilled}
            style={!isSatuanFilled ? disabledStyle : undefined}
          />
        </div>
      </div>
    </div>
  );
}
