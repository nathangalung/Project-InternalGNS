import { useState } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";
import ClientAdd from "../shared/ClientAdd";
import ProductAdd from "../shared/ProductAdd";
import DiscountAdd from "../shared/DiscountAdd";

// Import komponen Steps yang sudah dipisah
import Step1Client from "./Step1Client";
import Step2Product from "./Step2Product";
import Step3Shipping from "./Step3Shipping";
import Step4Summary from "./Step4Summary";

interface QuotationEditProps {
  quotationId: string;
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
  { id: "C001", name: "PT Astra Modern",    narahubung: "Budi Santoso",    country: "Indonesia", initials: "AM" },
  { id: "C002", name: "PT Telkom Prakarsa", narahubung: "Siti Rahayu",     country: "Indonesia", initials: "TP" },
  { id: "C003", name: "Bank Loka Mandiri",  narahubung: "Ahmad Hidayat",   country: "Indonesia", initials: "BL" },
  { id: "C004", name: "Global Network",     narahubung: "Dewi Lestari",    country: "Indonesia", initials: "GN" },
  { id: "C005", name: "Indo Food Group",    narahubung: "Rudi Hartono",    country: "Indonesia", initials: "IF" },
  { id: "C006", name: "Tech Solutions",     narahubung: "Linda Wijaya",    country: "Indonesia", initials: "TS" },
  { id: "C007", name: "Mandiri Finance",    narahubung: "Andi Pratama",    country: "Indonesia", initials: "MF" },
  { id: "C008", name: "Surya Kencana",      narahubung: "Maya Kusuma",     country: "Indonesia", initials: "SK" },
  { id: "C009", name: "Delta Logistik",     narahubung: "Bambang Sutrisno", country: "Indonesia", initials: "DL" },
];

export interface ProductItem {
  id: number;
  nama: string;
  kodeImpa: string;
  vendor: string;
  jumlah: number;
  satuan: string;
  hargaBeli: number;
  hargaJual: number;
}

const initialProducts: ProductItem[] = [
  { id: 1, nama: "Marine Engine Filter Element",       kodeImpa: "330212", vendor: "PT Bahari Teknik",    jumlah: 24, satuan: "PCS", hargaBeli: 5006500,  hargaJual: 6587500  },
  { id: 2, nama: "Oli Hidrolik Kelas Industri (200L)", kodeImpa: "590741", vendor: "CV Pelumas Nusantara", jumlah: 10, satuan: "DRM", hargaBeli: 16688900, hargaJual: 18523300 },
  { id: 3, nama: "Shackle Tugas Berat (M42)",          kodeImpa: "626718", vendor: "PT Besi Kuat",         jumlah: 2,  satuan: "UNT", hargaBeli: 2970500,  hargaJual: 3587500  },
];

function formatRp(n: number): string {
  return n.toLocaleString("id-ID");
}

export default function QuotationEdit({ quotationId, onNavigate, onLogout }: QuotationEditProps) {
  const [step, setStep] = useState(1);
  
  // State Step 1 (Klien)
  const [selectedClient, setSelectedClient] = useState("C001");
  const [search, setSearch] = useState("");
  const [showClientAdd, setShowClientAdd] = useState(false);
  
  // State Step 2 (Produk & Diskon)
  const [showProductAdd, setShowProductAdd] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [products, setProducts] = useState<ProductItem[]>(initialProducts);
  const [prodPageSize, setProdPageSize] = useState(5);
  const [prodPage, setProdPage] = useState(1);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);

  // State Step 3 (Pengiriman)
  const [shippingAddress, setShippingAddress] = useState("Jalan Rasuna Said, Kecamatan Jakarta Selatan, JKT 14230");
  const [shippingTime, setShippingTime] = useState("3");
  const [shippingCost, setShippingCost] = useState("3570000");

  // State Step 4 (Ringkasan/Tenggat Waktu)
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [berlakuSampai, setBerlakuSampai] = useState("");

  // Logika Penguncian
  const isAlamatFilled = shippingAddress.trim().length >= 20 && /[a-zA-Z]/.test(shippingAddress);
  const isWaktuFilled = isAlamatFilled && shippingTime.trim().length > 0;
  const isBiayaFilled = isWaktuFilled && shippingCost.trim().length > 0;
  const isTenggatWaktuFilled = jatuhTempo.trim().length > 0 && berlakuSampai.trim().length > 0;

  let isNextDisabled = false;
  if (step === 1) isNextDisabled = selectedClient === "";
  if (step === 3) isNextDisabled = !isBiayaFilled;

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
  const summaryDpp = Math.round(summarySubTotal * 11 / 12);
  const summaryPpn = summarySubTotal - summaryDpp;
  const summaryShippingCost = Number(shippingCost) || 0;
  
  const summaryGrandTotal = summarySubTotal + summaryPpn + summaryShippingCost;
  const summaryProfit = summarySubTotal - summaryTotalHargaBeli;

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
                <span className="qd-breadcrumb-current">Edit Quotation</span>
              </nav>
              <div className="qe-title-row">
                <h1 className="qe-title">Edit Quotation</h1>
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
                <button className="btn-admin-primary" onClick={() => onNavigate("quotation-detail")} disabled={!isTenggatWaktuFilled} style={{ width: "148px", justifyContent: "center", background: "#630ED4", opacity: !isTenggatWaktuFilled ? 0.5 : 1, cursor: !isTenggatWaktuFilled ? "not-allowed" : "pointer", transition: "opacity 0.2s" }}>
                  Simpan
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