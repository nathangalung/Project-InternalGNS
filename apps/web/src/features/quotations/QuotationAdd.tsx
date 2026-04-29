import { useEffect, useMemo, useState } from "react";
import type { Page } from "../../main";
import Sidebar from "@/components/shared/Sidebar";
import ClientAdd from "@/features/clients/ClientAdd";
import ProductAdd from "@/features/items/ProductAdd";
import DiscountModal from "./DiscountModal";
import { useClients, useClientSearch } from "@/features/clients/hooks";
import { useUnits } from "@/features/units/hooks";
import { useCreateQuotation } from "@/features/quotations/hooks";
import type { ClientRow, ClientSearchHit, QuotationCreateInput, QuotationItemInput } from "@/types/api";

import Step1Client, { type Client } from "./Step1Client";
import Step2Product from "./Step2Product";
import Step3Shipping from "./Step3Shipping";
import Step4Summary from "./Step4Summary";
import type { ProductItem } from "./QuotationEdit";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function fromClientRow(c: ClientRow): Client & { contactId?: number } {
  return {
    id: String(c.id),
    name: c.name,
    narahubung: c.contactName ?? "",
    country: c.countryCode,
    initials: initialsOf(c.name),
    phone: c.contactPhone,
    email: c.contactEmail ?? c.email,
    npwp: c.npwp,
    nomorTKU: c.tkuId,
    referenceNumber: c.number,
    lokasi: c.address,
    contactId: c.contactId,
  };
}

function fromClientHit(h: ClientSearchHit): Client & { contactId?: number } {
  return {
    id: String(h.companyId),
    name: h.companyName,
    narahubung: h.contactName ?? "",
    country: h.companyCountry,
    initials: initialsOf(h.companyName),
    phone: h.contactPhone,
    email: h.contactEmail ?? h.companyEmail,
    npwp: h.companyNpwp,
    nomorTKU: h.companyTku,
    referenceNumber: h.companyNumber,
    lokasi: h.companyAddress,
    contactId: h.contactId,
  };
}

function dedupeByCompany(hits: ClientSearchHit[]): ClientSearchHit[] {
  const seen = new Set<number>();
  const out: ClientSearchHit[] = [];
  for (const h of hits) {
    if (seen.has(h.companyId)) continue;
    seen.add(h.companyId);
    out.push(h);
  }
  return out;
}

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

function formatRp(n: number): string {
  return n.toLocaleString("id-ID");
}

export default function QuotationAdd({ onNavigate, onLogout }: QuotationAddProps) {
  const [step, setStep] = useState(1);
  
  // Empty client for add mode.
  const [selectedClient, setSelectedClient] = useState("");
  const [search, setSearch] = useState("");
  const [showClientAdd, setShowClientAdd] = useState(false);
  
  // ProductAdd form state.
  const [showProductAdd, setShowProductAdd] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountPct, setDiscountPct] = useState<number>(0);
  
  // Empty products.
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [prodPageSize, setProdPageSize] = useState(5);
  const [prodPage, setProdPage] = useState(1);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);

  // Empty shipping.
  const [shippingAddress, setShippingAddress] = useState("");
  const [shippingTime, setShippingTime] = useState("");
  const [shippingCost, setShippingCost] = useState("");

  // Deadline state.
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [berlakuSampai, setBerlakuSampai] = useState("");

  // Step gating logic.
  const isAlamatFilled = shippingAddress.trim().length >= 20 && /[a-zA-Z]/.test(shippingAddress);
  const isWaktuFilled = isAlamatFilled && shippingTime.trim().length > 0;
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

  const trimmedSearch = search.trim();
  const { data: clientsData } = useClients({ limit: 50 });
  const { data: searchHits } = useClientSearch(trimmedSearch, { limit: 30 });
  const { data: unitsData } = useUnits();
  const createQuotation = useCreateQuotation();

  const remoteClients: Array<Client & { contactId?: number }> = useMemo(() => {
    if (trimmedSearch.length > 0) {
      return dedupeByCompany(searchHits ?? []).map(fromClientHit);
    }
    return (clientsData ?? []).map(fromClientRow);
  }, [trimmedSearch, searchHits, clientsData]);

  const baseClients: Client[] = remoteClients;
  const sortedClients = [...baseClients].sort((a, b) => a.name.localeCompare(b.name, "id"));
  const filteredClients = trimmedSearch && remoteClients.length === 0
    ? sortedClients.filter((c) =>
        c.name.toLowerCase().includes(trimmedSearch.toLowerCase()) ||
        c.narahubung.toLowerCase().includes(trimmedSearch.toLowerCase()),
      )
    : sortedClients.slice(0, 10);

  const currentClient = baseClients.find((c) => c.id === selectedClient);
  const currentContactId = (currentClient as (Client & { contactId?: number }) | undefined)?.contactId;

  const unitIdByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of unitsData ?? []) m.set(u.code.toUpperCase(), u.id);
    return m;
  }, [unitsData]);

  const numericClientId = Number(selectedClient);
  const canSubmit = Number.isFinite(numericClientId) && numericClientId > 0
    && (products.length === 0 || products.every((p) => unitIdByCode.has(p.satuan.toUpperCase())))
    && isTenggatWaktuFilled && hasContent;

  function buildItems(): QuotationItemInput[] {
    const items: QuotationItemInput[] = products.map((p) => ({
      requestedImpa: p.kodeImpa || undefined,
      requestedName: p.nama,
      qty: String(p.jumlah),
      unitId: unitIdByCode.get(p.satuan.toUpperCase()) ?? 0,
      sellingPrice: String(p.hargaJual),
      costPrice: String(p.hargaBeli),
    }));
    return items;
  }

  function daysBetween(fromIso: string, toIso: string): number | undefined {
    const a = new Date(fromIso).getTime();
    const b = new Date(toIso).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
    return Math.max(0, Math.round((b - a) / 86_400_000));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    const validity = daysBetween(jatuhTempo, berlakuSampai);
    const shippingDays = Number(shippingTime);
    const input: QuotationCreateInput = {
      companyClientId: numericClientId,
      contactId: currentContactId,
      clientRefNo: currentClient?.referenceNumber,
      validityDays: validity,
      discountPct: String(discountPct),
      shippingAddress: shippingAddress || undefined,
      shippingDays: Number.isFinite(shippingDays) && shippingDays > 0 ? shippingDays : undefined,
      shippingCost: shippingCost || undefined,
      items: buildItems(),
    };
    createQuotation.mutate(input, {
      onSuccess: () => onNavigate("quotation"),
    });
  }

  // Summary computation.
  const summaryTotalProdukQty = products.reduce((sum, p) => sum + p.jumlah, 0);
  const summaryTotalHargaBeli = products.reduce((sum, p) => sum + (p.hargaBeli * p.jumlah), 0);
  const summaryTotalHargaJual = products.reduce((sum, p) => sum + (p.hargaJual * p.jumlah), 0);
  const nominalDiskon = summaryTotalHargaJual * (discountPct / 100);
  const summarySubTotal = summaryTotalHargaJual - nominalDiskon;
  const summaryShippingCost = Number(shippingCost) || 0;
  const hasProducts = products.length > 0;
  // Tax base depends on products.
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
                <button className="btn-admin-primary" onClick={handleSubmit} disabled={!isTenggatWaktuFilled || !hasContent || createQuotation.isPending} style={{ width: "180px", justifyContent: "center", background: "#630ED4", opacity: !isTenggatWaktuFilled || !hasContent || createQuotation.isPending ? 0.5 : 1, cursor: !isTenggatWaktuFilled || !hasContent || createQuotation.isPending ? "not-allowed" : "pointer", transition: "opacity 0.2s" }}>
                  {createQuotation.isPending ? "Menyimpan..." : "Buat Penawaran"}
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
      <DiscountModal open={showDiscountModal} onOpenChange={setShowDiscountModal} initialDiscount={discountPct} onSuccess={(val) => { setDiscountPct(val); setShowDiscountModal(false); }} />
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