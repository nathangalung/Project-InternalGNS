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
  requestMatches: CatalogItem[];
  activeProductLabel?: string;
  productOpen: boolean;
  productRequestOpen: boolean;
  satuanOpen: boolean;
  satuanOptions: string[];
  setOpenDropdown: (key: DropdownKey | null) => void;
  closeIfMatch: (key: DropdownKey) => void;
  toggleDropdown: (key: DropdownKey) => void;
  isProductFilled: boolean;
  isSatuanFilled: boolean;
  onAddProductNew: () => void;
  onPickProduct?: (item: CatalogItem) => void;
  onPickRequestSuggestion?: (item: CatalogItem) => void;
  onCopyRequestToOffer?: () => void;
}

// Product identity card.
export default function IdentityCard({
  form,
  onChange,
  productMatches,
  requestMatches,
  activeProductLabel,
  productOpen,
  productRequestOpen,
  satuanOpen,
  satuanOptions,
  setOpenDropdown,
  closeIfMatch,
  toggleDropdown,
  isProductFilled,
  isSatuanFilled,
  onAddProductNew,
  onPickProduct,
  onPickRequestSuggestion,
  onCopyRequestToOffer,
}: IdentityCardProps) {
  const canCopy = form.requestedKodeImpaNama.trim().length > 0;
  const activeRequestLabel = form.requestedKodeImpaNama.trim();
  return (
    <>
      <div className="ca-section">
        <div className="ca-section-heading">Permintaan Klien (Request)</div>
        <div className="ca-field">
          <label className="ca-label">Kode IMPA/Nama Produk Request <span className="ca-required">*</span></label>
          <div style={{ position: "relative" }}>
            <input
              className="ca-input"
              type="text"
              placeholder="Cari produk atau ketik permintaan klien"
              value={form.requestedKodeImpaNama}
              onChange={e => { onChange("requestedKodeImpaNama", e.target.value); setOpenDropdown("productRequest"); }}
              onFocus={() => setOpenDropdown("productRequest")}
              onBlur={() => setTimeout(() => closeIfMatch("productRequest"), 150)}
            />
            {productRequestOpen && (
              <div style={dropdownPanelStyle}>
                {requestMatches.length === 0 ? (
                  <div style={{ padding: "10px 20px", ...dropdownLabelStyle(false) }}>
                    Tidak ada rekomendasi — input akan disimpan apa adanya.
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "6px 20px 4px", fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "#9CA3AF" }}>
                      Rekomendasi dari katalog
                    </div>
                    {requestMatches.map(p => {
                      const label = formatKodeNama(p.kode, p.nama);
                      const isActive = label === activeRequestLabel;
                      return (
                        <button
                          key={p.id ?? label}
                          type="button"
                          style={dropdownItemStyle}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            onChange("requestedKodeImpaNama", label);
                            onPickRequestSuggestion?.(p);
                            setOpenDropdown(null);
                          }}
                        >
                          <span style={dropdownLabelStyle(isActive)}>{label}</span>
                          {isActive && <CheckmarkIcon />}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {onCopyRequestToOffer && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            margin: "-8px 0 8px",
            background: "rgba(99, 14, 212, 0.04)",
            border: "1px dashed rgba(99, 14, 212, 0.25)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: 999,
              background: "rgba(99, 14, 212, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#630ED4",
            }}
            aria-hidden
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M19 12l-7 7-7-7" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600, color: "#4A4455", lineHeight: 1.4 }}>
              Salin produk request langsung sebagai offer.
            </div>
          </div>
          <button
            type="button"
            onClick={onCopyRequestToOffer}
            disabled={!canCopy}
            title="Pakai nilai request sebagai offer (untuk produk baru di luar katalog)"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              background: canCopy ? "#630ED4" : "rgba(99, 14, 212, 0.18)",
              border: "none",
              borderRadius: 6,
              cursor: canCopy ? "pointer" : "not-allowed",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              fontWeight: 600,
              color: canCopy ? "#FFFFFF" : "rgba(99, 14, 212, 0.55)",
              transition: "background 0.15s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Salin ke Offer
          </button>
        </div>
      )}

      <div className="ca-section">
        <div className="ca-section-heading">Produk yang Ditawarkan (Offer)</div>

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
    </>
  );
}
