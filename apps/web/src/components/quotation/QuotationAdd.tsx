import { useState, useEffect } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";
import ClientAdd from "../shared/ClientAdd";
import ProductAdd from "../shared/ProductAdd";
import DiscountAdd from "../shared/DiscountAdd";

// Menggunakan Step komponen yang sama dengan QuotationEdit
import Step1Client from "./Step1Client";
import Step2Product from "./Step2Product";
import Step3Shipping from "./Step3Shipping";
import Step4Summary from "./Step4Summary";
import type { ProductItem } from "./QuotationEdit";

interface QuotationAddProps {
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}

const steps = [
  { n: 1, label: "KLIEN" },
  { n: 2, label: "PRODUK" },
  { n: 3, label: "PENGIRIMAN" },
  { n: 4, label: "RINGKASAN" },
];

const clients = [
  { id: "C001", name: "PT Astra Modern",    narahubung: "Budi Santoso",     country: "Indonesia", initials: "AM", phone: "+62 812-3456-7890", email: "budi@astramodern.co.id",      nomorTKU: "100210293840001", referenceNumber: "15823991992", npwp: "01.234.567.8-091.000", lokasi: "Jl. Gaya Motor Raya No.8, Jakarta Utara 14330" },
  { id: "C002", name: "PT Telkom Prakarsa", narahubung: "Siti Rahayu",      country: "Indonesia", initials: "TP", phone: "+62 821-9876-5432", email: "siti@telkomprakarsa.co.id",   nomorTKU: "200319482930002", referenceNumber: "28491029384", npwp: undefined,              lokasi: "Jl. Gatot Subroto Kav. 52, Jakarta Selatan 12710" },
  { id: "C003", name: "Bank Loka Mandiri",  narahubung: "Ahmad Hidayat",    country: "Indonesia", initials: "BL", phone: "+62 857-1234-5678", email: "ahmad@lokmandiri.co.id",      nomorTKU: undefined,         referenceNumber: undefined,     npwp: undefined,              lokasi: "Jl. Sudirman No. 24, Jakarta Pusat 10220" },
  { id: "C004", name: "Global Network",     narahubung: "Dewi Lestari",     country: "Indonesia", initials: "GN", phone: "+62 813-5678-9012", email: "dewi@globalnetwork.co.id",    nomorTKU: undefined,         referenceNumber: "39201029384", npwp: "04.567.890.1-234.000", lokasi: "Jl. M.H. Thamrin No. 9, Jakarta Pusat 10340" },
  { id: "C005", name: "Indo Food Group",    narahubung: "Rudi Hartono",     country: "Indonesia", initials: "IF", phone: "+62 878-2345-6789", email: "rudi@indofoodgroup.co.id",    nomorTKU: "500512938471005", referenceNumber: "48291038475", npwp: "05.678.901.2-345.000", lokasi: "Jl. Jend. Sudirman Kav. 76, Jakarta Selatan 12910" },
  { id: "C006", name: "Tech Solutions",     narahubung: "Linda Wijaya",     country: "Indonesia", initials: "TS", phone: "+62 856-3456-7890", email: "linda@techsolutions.co.id",   nomorTKU: "600619273640006", referenceNumber: "57382910293", npwp: undefined,              lokasi: "Jl. TB Simatupang No. 57, Jakarta Selatan 12430" },
  { id: "C007", name: "Mandiri Finance",    narahubung: "Andi Pratama",     country: "Indonesia", initials: "MF", phone: "+62 819-4567-8901", email: "andi@mandirifinance.co.id",   nomorTKU: "700728364750007", referenceNumber: "66473829102", npwp: "07.890.123.4-567.000", lokasi: "Jl. Imam Bonjol No. 61, Jakarta Pusat 10310" },
  { id: "C008", name: "Surya Kencana",      narahubung: "Maya Kusuma",      country: "Indonesia", initials: "SK", phone: "+62 895-5678-9012", email: "maya@suryakencana.co.id",     nomorTKU: "800837455860008", referenceNumber: "75564738291", npwp: "08.901.234.5-678.000", lokasi: "Jl. Raya Kebayoran Lama No. 234, Jakarta Selatan 12220" },
  { id: "C009", name: "Delta Logistik",     narahubung: "Bambang Sutrisno", country: "Indonesia", initials: "DL", phone: "+62 852-6789-0123", email: "bambang@deltalogistik.co.id", nomorTKU: undefined,         referenceNumber: undefined,     npwp: undefined,              lokasi: "Jl. Raya Cakung No. 88, Jakarta Timur 13910" },
];

function formatRp(n: number): string {
  return n.toLocaleString("id-ID");
}

export default function QuotationAdd({ onNavigate, onLogout }: QuotationAddProps) {
  const [step, setStep] = useState(1);
  
  // Karena ini Tambah, klien diisi KOSONG
  const [selectedClient, setSelectedClient] = useState("");
  const [search, setSearch] = useState("");
  const [showClientAdd, setShowClientAdd] = useState(false);
  
  // State untuk form ProductAdd
  const [showProductAdd, setShowProductAdd] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountPct, setDiscountPct] = useState<number>(0);
  
  // Produk diisi KOSONG
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [prodPageSize, setProdPageSize] = useState(5);
  const [prodPage, setProdPage] = useState(1);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);

  // Data pengiriman diisi KOSONG
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingTime, setShippingTime] = useState("");
  const [shippingCost, setShippingCost] = useState("");

  // State Tenggat Waktu
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [berlakuSampai, setBerlakuSampai] = useState("");

  // Logika Penguncian
  const isAlamatFilled = shippingAddress.trim().length >= 20 && /[a-zA-Z]/.test(shippingAddress);
  const isWaktuFilled = isAlamatFilled && shippingTime.trim().length > 0;
  const isBiayaFilled = isWaktuFilled && shippingCost.trim().length > 0;
  const isTenggatWaktuFilled = jatuhTempo.trim().length > 0 && berlakuSampai.trim().length > 0;
  const hasContent = products.length > 0 || isAlamatFilled;

  useEffect(() => {
    if (!isAlamatFilled) { setShippingTime(""); setShippingCost(""); }
  }, [isAlamatFilled]);

  useEffect(() => {
    if (!isWaktuFilled) setShippingCost("");
  }, [isWaktuFilled]);

  let isNextDisabled = false;
  if (step === 1) isNextDisabled = selectedClient === "";

  const disabledStyle: React.CSSProperties = { opacity: 0.6, cursor: "not-allowed", backgroundColor: "#F7F7F8" };

  function deleteProduct(id: number) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name, "id"));
  const filteredClients = search.trim()
    ? sortedClients.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.narahubung.toLowerCase().includes(search.toLowerCase())
      )
    : sortedClients.slice(0, 10);

  const currentClient = clients.find(c => c.id === selectedClient);

  // Perhitungan Ringkasan
  const summaryTotalProdukQty = products.reduce((sum, p) => sum + p.jumlah, 0);
  const summaryTotalHargaBeli = products.reduce((sum, p) => sum + (p.hargaBeli * p.jumlah), 0);
  const summaryTotalHargaJual = products.reduce((sum, p) => sum + (p.hargaJual * p.jumlah), 0);
  const nominalDiskon = summaryTotalHargaJual * (discountPct / 100);
  const summarySubTotal = summaryTotalHargaJual - nominalDiskon;
  const summaryShippingCost = Number(shippingCost) || 0;
  const hasProducts = products.length > 0;
  // Kalau hanya pengiriman (tanpa produk): DPP/PPN dikenakan pada biaya pengiriman
  // Kalau ada produk: DPP/PPN hanya dari subtotal produk, pengiriman tidak dikenakan pajak
  const dppBase = hasProducts ? summarySubTotal : summaryShippingCost;
  const summaryDpp = Math.round(dppBase * 11 / 12);
  const summaryPpn = dppBase - summaryDpp;
  const summaryGrandTotal = hasProducts
    ? summarySubTotal + summaryPpn + summaryShippingCost
    : summaryShippingCost + summaryPpn;
  const summaryProfit = hasProducts ? summarySubTotal - summaryTotalHargaBeli : 0;

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">

          {/* Header & Stepper */}
          <div className="qe-header-section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="qe-header-left">
              <nav className="qd-breadcrumb">
                <button className="qd-breadcrumb-link" onClick={() => onNavigate("quotation")}>Daftar Quotation</button>
                <span className="qd-breadcrumb-sep">&rsaquo;</span>
                <span className="qd-breadcrumb-current">Tambah Quotation</span>
              </nav>
              <div className="qe-title-row">
                <h1 className="qe-title">Tambah Quotation Baru</h1>
              </div>
            </div>

            <div className="qe-header-actions" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              {step > 1 && (
                <button className="btn-admin-outline" onClick={() => setStep(step - 1)} style={{ width: "148px", justifyContent: "center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg> Kembali
                </button>
              )}
              {step < steps.length && (
                <button className="btn-admin-primary" onClick={() => setStep(step + 1)} disabled={isNextDisabled} style={{ width: "148px", justifyContent: "center", opacity: isNextDisabled ? 0.5 : 1, cursor: isNextDisabled ? "not-allowed" : "pointer", transition: "opacity 0.2s" }}>
                  Lanjut <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "scaleX(-1)" }}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                </button>
              )}
              {step === steps.length && (
                <button className="btn-admin-primary" onClick={() => onNavigate("quotation")} disabled={!isTenggatWaktuFilled || !hasContent} style={{ width: "180px", justifyContent: "center", background: "#630ED4", opacity: !isTenggatWaktuFilled || !hasContent ? 0.5 : 1, cursor: !isTenggatWaktuFilled || !hasContent ? "not-allowed" : "pointer", transition: "opacity 0.2s" }}>
                  Buat Penawaran
                </button>
              )}
            </div>
          </div>

          <div className="qe-stepper">
            {steps.map((s, i) => (
              <div key={s.n} style={{display: 'contents'}}>
                <div className="qe-step-slot">
                  <div className={`qe-step-pill${i === step - 1 ? " qe-step-pill--active" : ""}`}><span className={`qe-step-num${i === step - 1 ? " qe-step-num--active" : ""}`}>{s.n}</span></div>
                  <span className={`qe-step-label${i === step - 1 ? " qe-step-label--active" : ""}`}>{s.label}</span>
                </div>
                {i < steps.length - 1 && <div key={`line-${i}`} className="qe-step-connector" />}
              </div>
            ))}
          </div>

          {/* Render Step Components */}
          {step === 1 && (
            <Step1Client 
              search={search} setSearch={setSearch} filteredClients={filteredClients} 
              selectedClient={selectedClient} setSelectedClient={setSelectedClient} setShowClientAdd={setShowClientAdd} 
            />
          )}
          {step === 2 && (
            <Step2Product
              products={products} deleteProduct={deleteProduct} setEditingProduct={setEditingProduct} setShowProductAdd={setShowProductAdd}
              prodPageSize={prodPageSize} setProdPageSize={setProdPageSize} prodPage={prodPage} setProdPage={setProdPage}
              isRowDropdownOpen={isRowDropdownOpen} setIsRowDropdownOpen={setIsRowDropdownOpen}
              setShowDiscountModal={setShowDiscountModal} discountPct={discountPct} formatRp={formatRp}
              summaryTotalHargaBeli={summaryTotalHargaBeli}
              summaryTotalHargaJual={summaryTotalHargaJual} nominalDiskon={nominalDiskon} summarySubTotal={summarySubTotal} summaryDpp={summaryDpp} summaryPpn={summaryPpn}
              onImportProducts={(newProds) => setProducts((prev) => [...prev, ...newProds])}
            />
          )}
          {step === 3 && (
            <Step3Shipping 
              shippingAddress={shippingAddress} setShippingAddress={setShippingAddress}
              shippingTime={shippingTime} setShippingTime={setShippingTime}
              shippingCost={shippingCost} setShippingCost={setShippingCost}
              isAlamatFilled={isAlamatFilled} isWaktuFilled={isWaktuFilled} disabledStyle={disabledStyle} formatRp={formatRp}
            />
          )}
          {step === 4 && (
            <Step4Summary 
              jatuhTempo={jatuhTempo} setJatuhTempo={setJatuhTempo} berlakuSampai={berlakuSampai} setBerlakuSampai={setBerlakuSampai}
              currentClient={currentClient} shippingAddress={shippingAddress} shippingTime={shippingTime} shippingCost={shippingCost}
              products={products} discountPct={discountPct} formatRp={formatRp}
              summaryTotalProdukQty={summaryTotalProdukQty} summaryTotalHargaBeli={summaryTotalHargaBeli} summaryTotalHargaJual={summaryTotalHargaJual}
              nominalDiskon={nominalDiskon} summarySubTotal={summarySubTotal} summaryDpp={summaryDpp} summaryPpn={summaryPpn}
              summaryShippingCost={summaryShippingCost} summaryProfit={summaryProfit} summaryGrandTotal={summaryGrandTotal}
            />
          )}

        </div>
      </div>

      {/* Modals */}
      <DiscountAdd open={showDiscountModal} onOpenChange={setShowDiscountModal} initialDiscount={discountPct} onSuccess={(val) => { setDiscountPct(val); setShowDiscountModal(false); }} />
      <ClientAdd open={showClientAdd} onOpenChange={setShowClientAdd} onSuccess={() => { setShowClientAdd(false); setStep(2); }} />
      <ProductAdd 
        open={showProductAdd} initialData={editingProduct} 
        onOpenChange={(open) => { setShowProductAdd(open); if (!open) setEditingProduct(null); }} 
        onSuccess={(data) => {
          const [kodePart, ...namaParts] = data.kodeImpaNama.split(/\s*-\s*/);
          const nama = namaParts.length > 0 ? namaParts.join(" - ") : kodePart;
          const kodeImpa = namaParts.length > 0 ? kodePart : "";

          if (editingProduct) {
            setProducts((prev) => prev.map(p => p.id === editingProduct.id ? { ...p, nama, kodeImpa, vendor: data.namaVendor, jumlah: Number(data.jumlahProduk) || 1, satuan: data.satuan, hargaBeli: Number(data.hargaBeli) || 0, hargaJual: Number(data.hargaJual) || 0 } : p));
          } else {
            const nextId = products.reduce((m, p) => Math.max(m, p.id), 0) + 1;
            setProducts((prev) => [ ...prev, { id: nextId, nama, kodeImpa, vendor: data.namaVendor, jumlah: Number(data.jumlahProduk) || 1, satuan: data.satuan, hargaBeli: Number(data.hargaBeli) || 0, hargaJual: Number(data.hargaJual) || 0 } ]);
          }
          setEditingProduct(null);
        }} 
      />
    </div>
  );
}