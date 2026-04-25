import { useState, useEffect, type CSSProperties } from "react";
import ProductAddNew from "./ProductAddNew";

export interface ProductAddFormData {
  kodeImpaNama: string;
  jumlahProduk: string;
  satuan: string;
  namaVendor: string;
  hargaBeli: string;
  hargaJual: string;
}

interface ProductAddProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (data: ProductAddFormData & { profit: number }) => void;
  initialData?: any; // Menerima data produk dari props
}

const SATUAN_OPTIONS = ["PCS", "LUSIN", "DRM", "UNT", "KG", "BOX"];

interface VendorOption {
  nama: string;
  harga: number; // 0 = belum ada riwayat harga beli
}

const VENDOR_OPTIONS: VendorOption[] = [
  { nama: "Marine Global Company 1", harga: 43000000 },
  { nama: "Marine Global Company 2", harga: 43250000 },
  { nama: "Marine Global Company 3", harga: 43300000 },
  { nama: "PT Bahari Teknik",        harga: 44100000 },
  { nama: "CV Pelumas Nusantara",    harga: 45200000 },
  { nama: "PT Mitra Samudera",       harga: 0 },
];

interface HistorisOption {
  keterangan: string;
  harga: number;
}

const HISTORIS_OPTIONS: HistorisOption[] = [
  { keterangan: "Penawaran Tanggal 20/04/2026", harga: 48000000 },
  { keterangan: "Penawaran Tanggal 15/03/2026", harga: 48500000 },
  { keterangan: "Penawaran Tanggal 10/02/2026", harga: 49000000 },
  { keterangan: "Penawaran Tanggal 05/01/2026", harga: 47500000 },
  { keterangan: "Penawaran Tanggal 01/12/2025", harga: 48250000 },
];

interface CatalogItem {
  kode: string;
  nama: string;
}

const PRODUCT_CATALOG: CatalogItem[] = [
  { kode: "111111", nama: "Galvanized Anchor Chain 22mm" },
  { kode: "136182", nama: "Marine Engine Filter Element" },
  { kode: "121331", nama: "LED Navigation Light - Red" },
  { kode: "330212", nama: "Marine Engine Filter Element" },
  { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)" },
  { kode: "626718", nama: "Shackle Tugas Berat (M42)" },
  { kode: "881020", nama: "Safety Helmet Industrial" },
  { kode: "770412", nama: "Wire Rope Stainless 12mm" },
];

const INITIAL_FORM: ProductAddFormData = {
  kodeImpaNama: "",
  jumlahProduk: "",
  satuan: "", 
  namaVendor: "",
  hargaBeli: "",
  hargaJual: "",
};

function parseRp(v: string): number {
  const n = Number(v.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatRp(n: number): string {
  return n.toLocaleString("id-ID");
}

const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "#FFFFFF",
  border: "1px solid rgba(204, 195, 216, 0.2)",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  padding: "8px 0",
  zIndex: 50,
};

const dropdownItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 20px",
  width: "100%",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

function dropdownLabelStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 700 : 500,
    fontSize: "14px",
    lineHeight: "20px",
    color: active ? "#630ED4" : "#4A4455",
  };
}

const confirmOverlayStyle: CSSProperties = {
  position: "fixed",
  top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const confirmModalStyle: CSSProperties = {
  background: "#FFFFFF",
  borderRadius: "12px",
  padding: "24px",
  width: "100%",
  maxWidth: "400px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
  fontFamily: "'Inter', sans-serif",
  display: "flex",
  flexDirection: "column",
  gap: "16px"
};

const CheckmarkIcon = () => (
  <svg width="14" height="11" viewBox="0 0 14 11" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

function AddNewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div style={{ borderTop: "1px solid rgba(204, 195, 216, 0.2)", marginTop: 4, paddingTop: 4, display: "flex", justifyContent: "flex-end" }}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        style={{
          padding: "4px 20px",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontWeight: 700,
          fontSize: "12px",
          lineHeight: "16px",
          color: "#630ED4",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="4.5" y1="1" x2="4.5" y2="8" stroke="#630ED4" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="1" y1="4.5" x2="8" y2="4.5" stroke="#630ED4" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {label}
      </button>
    </div>
  );
}

type DropdownKey = "product" | "satuan" | "vendor" | "historis";

interface NewVendorForm { nama: string; harga: string; }

export default function ProductAdd({ open, onOpenChange, onSuccess, initialData }: ProductAddProps) {
  const [form, setForm] = useState<ProductAddFormData>(INITIAL_FORM);
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);

  const [initialPrices, setInitialPrices] = useState<{ beli: number | null, jual: number | null }>({ beli: null, jual: null });
  const [showConfirm, setShowConfirm] = useState(false);

  const [productCatalog, setProductCatalog] = useState<CatalogItem[]>(PRODUCT_CATALOG);
  const [vendorOptions, setVendorOptions] = useState<VendorOption[]>(VENDOR_OPTIONS);
  const [showProductNew, setShowProductNew] = useState(false);
  const [showVendorNew, setShowVendorNew] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState<NewVendorForm>({ nama: "", harga: "" });

  // Mengisi form secara otomatis jika prop initialData ada (Mode Edit)
  useEffect(() => {
    if (open) {
      setProductCatalog([...PRODUCT_CATALOG]);
      setVendorOptions([...VENDOR_OPTIONS]);
      if (initialData) {
        setForm({
          kodeImpaNama: initialData.kodeImpa ? `${initialData.kodeImpa} - ${initialData.nama}` : initialData.nama,
          jumlahProduk: String(initialData.jumlah),
          satuan: initialData.satuan,
          namaVendor: initialData.vendor,
          hargaBeli: String(initialData.hargaBeli),
          hargaJual: String(initialData.hargaJual),
        });
        setInitialPrices({ beli: initialData.hargaBeli, jual: initialData.hargaJual });
      } else {
        setForm(INITIAL_FORM);
        setInitialPrices({ beli: null, jual: null });
      }
    }
  }, [open, initialData]);

  if (!open) return null;

  const productOpen = openDropdown === "product";
  const satuanOpen = openDropdown === "satuan";
  const vendorOpen = openDropdown === "vendor";
  const historisOpen = openDropdown === "historis";

  const hargaBeliVal = parseRp(form.hargaBeli);
  const profit = parseRp(form.hargaJual) - hargaBeliVal;
  const profitPct = hargaBeliVal > 0 ? ((profit / hargaBeliVal) * 100).toFixed(2) : "0.00";
  
  const isProductFilled = form.kodeImpaNama.trim().length > 0;
  const isSatuanFilled = isProductFilled && form.satuan.trim().length > 0;
  const isJumlahFilled = isSatuanFilled && form.jumlahProduk.trim().length > 0;
  const exactVendor = vendorOptions.find((v) => v.nama === form.namaVendor);
  const isVendorFilled = isJumlahFilled && exactVendor !== undefined;
  
  const disabledStyle: React.CSSProperties = {
    opacity: 0.6,
    cursor: "not-allowed",
    backgroundColor: "#F7F7F8"
  };

  function handleChange(field: keyof ProductAddFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleDropdown(key: DropdownKey) {
    setOpenDropdown((d) => (d === key ? null : key));
  }

  function handlePreSubmit() {
    const currentBeli = parseRp(form.hargaBeli);
    const currentJual = parseRp(form.hargaJual);
    
    const isBeliChanged = initialPrices.beli !== null && currentBeli !== initialPrices.beli;
    const isJualChanged = initialPrices.jual !== null && currentJual !== initialPrices.jual;

    if (isBeliChanged || isJualChanged) {
      setShowConfirm(true); 
    } else {
      executeSubmit(); 
    }
  }

  function executeSubmit() {
    onSuccess?.({ ...form, profit });
    setForm(INITIAL_FORM);
    setInitialPrices({ beli: null, jual: null });
    setOpenDropdown(null);
    setShowConfirm(false);
    onOpenChange(false);
  }

  function handleCancel() {
    setForm(INITIAL_FORM);
    setInitialPrices({ beli: null, jual: null });
    setOpenDropdown(null);
    setShowConfirm(false);
    onOpenChange(false);
  }

  const productQuery = form.kodeImpaNama.trim().toLowerCase();
  const productMatches = productQuery
    ? productCatalog.filter((p) =>
        p.kode.toLowerCase().includes(productQuery) ||
        p.nama.toLowerCase().includes(productQuery),
      ).slice(0, 3)
    : productCatalog.slice(0, 3);

  const exactProduct = productCatalog.find((p) => `${p.kode} - ${p.nama}` === form.kodeImpaNama);
  const activeProductKode = exactProduct?.kode ?? productMatches[0]?.kode;

  const vendorQuery = form.namaVendor.trim().toLowerCase();
  const sortedVendors = [...vendorOptions].sort((a, b) => {
    if (a.harga > 0 && b.harga > 0) return a.harga - b.harga;
    if (a.harga > 0) return -1;
    if (b.harga > 0) return 1;
    return 0;
  });
  const vendorMatches = vendorQuery
    ? sortedVendors.filter((v) => v.nama.toLowerCase().includes(vendorQuery))
    : sortedVendors;

  const currentBeli = parseRp(form.hargaBeli);
  const currentJual = parseRp(form.hargaJual);
  const isBeliChanged = initialPrices.beli !== null && currentBeli !== initialPrices.beli;
  const isJualChanged = initialPrices.jual !== null && currentJual !== initialPrices.jual;

  return (
    <>
      <div className="ca-overlay" onClick={handleCancel} style={{ display: showProductNew || showVendorNew ? "none" : undefined }}>
        <div className="ca-modal" onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div className="ca-header">
            {/* Judul berubah jika ada initialData (Edit) */}
            <h2 className="ca-title">{initialData ? "Edit Produk Quotation" : "Tambah Produk ke Quotation"}</h2>
            <button className="ca-close-btn" onClick={handleCancel} title="Tutup">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="1" y1="1" x2="13" y2="13"/>
                <line x1="13" y1="1" x2="1" y2="13"/>
              </svg>
            </button>
          </div>

          {/* Form Body */}
          <div className="ca-body">

            {/* Identitas Produk */}
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
                    onChange={(e) => { handleChange("kodeImpaNama", e.target.value); setOpenDropdown("product"); }}
                    onFocus={() => setOpenDropdown("product")}
                    onBlur={() => setTimeout(() => setOpenDropdown((d) => d === "product" ? null : d), 150)}
                  />
                  {productOpen && (
                    <div style={dropdownPanelStyle}>
                      {productMatches.length === 0 ? (
                        <div style={{ padding: "10px 20px", ...dropdownLabelStyle(false) }}>
                          Tidak ada hasil
                        </div>
                      ) : (
                        productMatches.map((p) => {
                          const label = `${p.kode} - ${p.nama}`;
                          const isActive = p.kode === activeProductKode;
                          return (
                            <button
                              key={p.kode}
                              type="button"
                              style={dropdownItemStyle}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { handleChange("kodeImpaNama", label); setOpenDropdown(null); }}
                            >
                              <span style={dropdownLabelStyle(isActive)}>{label}</span>
                              {isActive && <CheckmarkIcon />}
                            </button>
                          );
                        })
                      )}
                      <AddNewButton label="Tambah Produk Baru" onClick={() => { setOpenDropdown(null); setShowProductNew(true); }} />
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
                      onBlur={() => setTimeout(() => setOpenDropdown((d) => d === "satuan" ? null : d), 150)}
                      disabled={!isProductFilled}
                      style={{
                        ...(!isProductFilled ? disabledStyle : {}),
                        color: !form.satuan && isProductFilled ? "var(--color-text-muted)" : undefined
                      }}
                    >
                      <span>{form.satuan || "Pilih satuan"}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>
                    {satuanOpen && isProductFilled && (
                      <div style={dropdownPanelStyle}>
                        {SATUAN_OPTIONS.map((opt) => {
                          const isActive = form.satuan === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              style={dropdownItemStyle}
                              onClick={() => { handleChange("satuan", opt); setOpenDropdown(null); }}
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
                    onChange={(e) => handleChange("jumlahProduk", e.target.value)}
                    disabled={!isSatuanFilled}
                    style={!isSatuanFilled ? disabledStyle : undefined}
                  />
                </div>
              </div>
            </div>

            {/* Vendor dan Harga */}
            <div className="ca-section" style={{ opacity: !isJumlahFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}>
              <div className="ca-section-heading">Vendor dan Harga</div>

              <div className="ca-field">
                <label className="ca-label">Nama Vendor <span className="ca-required">*</span></label>
                <div style={{ position: "relative" }}>
                  <input
                    className="ca-input"
                    type="text"
                    placeholder="Ketik atau pilih vendor"
                    value={form.namaVendor}
                    disabled={!isJumlahFilled}
                    style={!isJumlahFilled ? disabledStyle : undefined}
                    onChange={(e) => { handleChange("namaVendor", e.target.value); setOpenDropdown("vendor"); }}
                    onFocus={() => { if (isJumlahFilled) setOpenDropdown("vendor"); }}
                    onBlur={() => setTimeout(() => setOpenDropdown((d) => d === "vendor" ? null : d), 150)}
                  />
                  {vendorOpen && isJumlahFilled && (
                    <div style={dropdownPanelStyle}>
                      {vendorMatches.length === 0 ? (
                        <div style={{ padding: "10px 20px", ...dropdownLabelStyle(false) }}>
                          Tidak ada hasil. Silahkan tambahkan vendor baru.
                        </div>
                      ) : (
                        vendorMatches.map((v) => {
                          const isActive = exactVendor?.nama === v.nama;
                          return (
                            <button
                              key={v.nama}
                              type="button"
                              style={dropdownItemStyle}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setForm((prev) => ({ ...prev, namaVendor: v.nama, hargaBeli: v.harga > 0 ? String(v.harga) : prev.hargaBeli }));
                                if (v.harga > 0) setInitialPrices((prev) => ({ ...prev, beli: v.harga }));
                                setOpenDropdown(null);
                              }}
                            >
                              <span style={dropdownLabelStyle(isActive)}>{v.nama}</span>
                              {v.harga > 0 ? (
                                <span style={{
                                  fontFamily: "'Inter', sans-serif",
                                  fontWeight: isActive ? 700 : 400,
                                  fontSize: "12px",
                                  lineHeight: "24px",
                                  color: isActive ? "#630ED4" : "#4A4455",
                                }}>
                                  Rp {formatRp(v.harga)}
                                </span>
                              ) : isActive ? <CheckmarkIcon /> : null}
                            </button>
                          );
                        })
                      )}
                      <AddNewButton label="Tambah Vendor Baru" onClick={() => { setOpenDropdown(null); setNewVendorForm({ nama: "", harga: "" }); setShowVendorNew(true); }} />
                    </div>
                  )}
                </div>
              </div>

              <div className="ca-row-2">
                <div className="ca-field">
                  <label className="ca-label">Harga Beli Satuan <span className="ca-required">*</span></label>
                  <input
                    className="ca-input"
                    type="number"
                    min={0}
                    placeholder="Masukkan harga beli"
                    value={form.hargaBeli}
                    onChange={(e) => handleChange("hargaBeli", e.target.value)}
                    disabled={!isVendorFilled}
                    style={!isVendorFilled ? disabledStyle : undefined}
                  />
                </div>
                <div className="ca-field">
                  <label className="ca-label">Harga Jual Satuan <span className="ca-required">*</span></label>
                  <input
                    className="ca-input"
                    type="number"
                    min={0}
                    placeholder="Masukkan harga jual"
                    value={form.hargaJual}
                    onChange={(e) => handleChange("hargaJual", e.target.value)}
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
                    e.preventDefault();
                    if (isVendorFilled) toggleDropdown("historis");
                  }}
                  onBlur={() => setTimeout(() => setOpenDropdown((d) => d === "historis" ? null : d), 150)}
                  style={{
                    width: "100%",
                    padding: "11px 24px",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: isVendorFilled ? "#630ED4" : "#A386D6",
                    background: "transparent",
                    border: isVendorFilled ? "1px solid rgba(99, 14, 212, 0.2)" : "1px solid rgba(99, 14, 212, 0.1)",
                    borderRadius: "8px",
                    cursor: isVendorFilled ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: !isVendorFilled ? "#F7F7F8" : "transparent"
                  }}
                >
                  <span>Historis Harga Jual</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ position: "absolute", right: "20px" }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                
                {historisOpen && isVendorFilled && (
                  <div style={{ ...dropdownPanelStyle, zIndex: 999 }}>
                    {HISTORIS_OPTIONS.map((h, i) => {
                      const isActive = form.hargaJual === String(h.harga);
                      return (
                        <button
                          key={i}
                          type="button"
                          style={dropdownItemStyle}
                          onClick={(e) => {
                            e.preventDefault();
                            handleChange("hargaJual", String(h.harga));
                            setInitialPrices((prev) => ({ ...prev, jual: h.harga })); 
                            setOpenDropdown(null);
                          }}
                        >
                          <span style={dropdownLabelStyle(isActive)}>{h.keterangan}</span>
                          <span style={{
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: isActive ? 700 : 400,
                            fontSize: "12px",
                            lineHeight: "24px",
                            color: isActive ? "#630ED4" : "#4A4455",
                          }}>
                            Rp {formatRp(h.harga)}
                          </span>
                        </button>
                      );
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
                    backgroundColor: !isVendorFilled ? "#F7F7F8" : undefined
                  }}
                >
                  {profit === 0 ? "Otomatis terisi" : `Rp ${formatRp(profit)} (${profitPct}%)`}
                </div>
              </div>
            </div>

          </div>

          <div className="ca-footer">
            <button type="button" className="ca-btn-cancel" onClick={handleCancel}>Batal</button>
            {/* Tombol menyesuaikan Edit atau Tambah */}
            <button type="button" className="ca-btn-submit" onClick={handlePreSubmit}>
              {initialData ? "Simpan Perubahan" : "Simpan Data"}
            </button>
          </div>

        </div>
      </div>

      {/* Modal Tambah Produk Baru */}
      <ProductAddNew
        open={showProductNew}
        onOpenChange={setShowProductNew}
        onSuccess={(data) => {
          const newItem: CatalogItem = { kode: data.kode || "", nama: data.nama };
          setProductCatalog((prev) => [...prev, newItem]);
          const label = newItem.kode ? `${newItem.kode} - ${newItem.nama}` : newItem.nama;
          handleChange("kodeImpaNama", label);
          if (data.satuan) handleChange("satuan", data.satuan);
          setShowProductNew(false);
        }}
      />

      {/* Modal Tambah Vendor Baru */}
      {showVendorNew && (
        <div style={confirmOverlayStyle} onClick={() => setShowVendorNew(false)}>
          <div style={{ ...confirmModalStyle, maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111827" }}>Tambah Vendor Baru</h3>
              <button onClick={() => setShowVendorNew(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#6B7280" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", marginBottom: "6px" }}>Nama Vendor <span style={{ color: "#EF4444" }}>*</span></label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="Masukkan nama vendor"
                  value={newVendorForm.nama}
                  onChange={(e) => setNewVendorForm((p) => ({ ...p, nama: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", marginBottom: "6px" }}>Harga Beli (Rp)</label>
                <input
                  className="ca-input"
                  type="number"
                  min={0}
                  placeholder="Masukkan harga beli"
                  value={newVendorForm.harga}
                  onChange={(e) => setNewVendorForm((p) => ({ ...p, harga: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button onClick={() => setShowVendorNew(false)} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #D1D5DB", background: "#fff", color: "#374151", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Batal</button>
              <button
                onClick={() => {
                  if (!newVendorForm.nama.trim()) return;
                  const harga = Number(newVendorForm.harga) || 0;
                  const newVendor: VendorOption = { nama: newVendorForm.nama.trim(), harga };
                  setVendorOptions((prev) => [...prev, newVendor]);
                  setForm((prev) => ({ ...prev, namaVendor: newVendor.nama, hargaBeli: harga > 0 ? String(harga) : prev.hargaBeli }));
                  if (harga > 0) setInitialPrices((prev) => ({ ...prev, beli: harga }));
                  setShowVendorNew(false);
                }}
                disabled={!newVendorForm.nama.trim()}
                style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "#630ED4", color: "#fff", fontWeight: 600, fontSize: "14px", cursor: "pointer", opacity: !newVendorForm.nama.trim() ? 0.5 : 1 }}
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Perubahan Harga */}
      {showConfirm && (
        <div style={confirmOverlayStyle} onClick={() => setShowConfirm(false)}>
          <div style={confirmModalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111827" }}>
              Konfirmasi Perubahan Harga
            </h3>
            <p style={{ margin: 0, fontSize: "14px", color: "#4B5563", lineHeight: "1.5" }}>
              Apakah Anda yakin mengubah:
            </p>
            
            <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "14px", color: "#374151" }}>
              {isBeliChanged && (
                <li style={{ marginBottom: "8px" }}>
                  Harga beli dari <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(initialPrices.beli!)}</strong> menjadi <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(currentBeli)}</strong>
                </li>
              )}
              {isJualChanged && (
                <li>
                  Harga jual dari <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(initialPrices.jual!)}</strong> menjadi <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(currentJual)}</strong>
                </li>
              )}
            </ul>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #D1D5DB",
                  background: "#FFFFFF",
                  color: "#374151",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: "pointer"
                }}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeSubmit}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#630ED4",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px",
                  cursor: "pointer"
                }}
              >
                Iya
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}