import { useEffect, useMemo, useState } from "react";
import ProductCreateModal from "../ProductCreateModal";
import IdentityCard from "./IdentityCard";
import PriceConfirmModal from "./PriceConfirmModal";
import VendorAddModal from "./VendorAddModal";
import VendorPriceCard from "./VendorPriceCard";
import {
  type CatalogItem,
  type DropdownKey,
  type HistorisOption,
  INITIAL_FORM,
  type NewVendorForm,
  type ProductAddFormData,
  type VendorOption,
  formatKodeNama,
  parseRp,
} from "./helpers";
import { useItemPriceHistory, useItemSearch, useItemVendors, useItems } from "@/features/items/hooks";
import { useUnits } from "@/features/units/hooks";
import { useCreateVendor } from "@/features/vendors/hooks";

export type { ProductAddFormData } from "./helpers";

interface ProductAddProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (data: ProductAddFormData & { profit: number }) => void;
  initialData?: any;
}

// Product creation orchestrator.
export default function ProductAdd({ open, onOpenChange, onSuccess, initialData }: ProductAddProps) {
  const [form, setForm] = useState<ProductAddFormData>(INITIAL_FORM);
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);

  const [initialPrices, setInitialPrices] = useState<{ beli: number | null; jual: number | null }>({ beli: null, jual: null });
  const [showConfirm, setShowConfirm] = useState(false);

  const [pickedItemId, setPickedItemId] = useState<number | null>(null);
  const [extraVendors, setExtraVendors] = useState<VendorOption[]>([]);
  const [showProductNew, setShowProductNew] = useState(false);
  const [showVendorNew, setShowVendorNew] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState<NewVendorForm>({ nama: "", harga: "" });

  const { data: units } = useUnits();
  const satuanOptions = useMemo(() => (units ?? []).map(u => u.code), [units]);

  const productQueryRaw = form.kodeImpaNama.trim();
  const { data: searchHits } = useItemSearch(productQueryRaw, { limit: 10 });
  const { data: itemsAll } = useItems({ limit: 50 });
  const productCatalog: CatalogItem[] = useMemo(() => {
    if (productQueryRaw.length > 0) {
      return (searchHits ?? []).map(h => ({
        id: h.id,
        kode: h.impaCode ?? "",
        nama: h.name,
        defaultUnitId: h.defaultUnitId,
      }));
    }
    return (itemsAll ?? []).map(r => ({
      id: r.id,
      kode: r.impaCode ?? "",
      nama: r.name,
      defaultUnitId: r.defaultUnitId,
    }));
  }, [productQueryRaw, searchHits, itemsAll]);

  const { data: vendorRows } = useItemVendors(pickedItemId ?? undefined);
  const vendorOptions: VendorOption[] = useMemo(() => {
    const remote = (vendorRows ?? []).map(r => ({
      nama: r.vendorName,
      harga: r.costPrice ? Number(r.costPrice) : 0,
      vendorId: r.vendorId,
    }));
    return [...remote, ...extraVendors];
  }, [vendorRows, extraVendors]);

  const { data: priceHistoryRows } = useItemPriceHistory(pickedItemId ?? undefined, 10);
  const historisOptions: HistorisOption[] = useMemo(
    () =>
      (priceHistoryRows ?? []).map(r => ({
        keterangan: `${r.quotationNo} - ${r.clientName}`,
        harga: Number(r.sellingPrice) || 0,
      })),
    [priceHistoryRows],
  );

  const createVendor = useCreateVendor();

  useEffect(() => {
    if (open) {
      setExtraVendors([]);
      if (initialData) {
        setForm({
          kodeImpaNama: formatKodeNama(initialData.kodeImpa, initialData.nama),
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
        setPickedItemId(null);
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
  const exactVendor = vendorOptions.find(v => v.nama === form.namaVendor);
  const isVendorFilled = isJumlahFilled && exactVendor !== undefined;

  function handleChange(field: keyof ProductAddFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function toggleDropdown(key: DropdownKey) {
    setOpenDropdown(d => (d === key ? null : key));
  }

  function closeIfMatch(key: DropdownKey) {
    setOpenDropdown(d => (d === key ? null : d));
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
    ? productCatalog
        .filter(p => p.kode.toLowerCase().includes(productQuery) || p.nama.toLowerCase().includes(productQuery))
        .slice(0, 3)
    : productCatalog.slice(0, 3);

  const activeProductLabel = form.kodeImpaNama.trim().length > 0
    ? productCatalog
        .map(p => formatKodeNama(p.kode, p.nama))
        .find(label => label === form.kodeImpaNama)
    : undefined;

  const vendorQuery = form.namaVendor.trim().toLowerCase();
  const sortedVendors = [...vendorOptions].sort((a, b) => {
    if (a.harga > 0 && b.harga > 0) return a.harga - b.harga;
    if (a.harga > 0) return -1;
    if (b.harga > 0) return 1;
    return 0;
  });
  const vendorMatches = vendorQuery
    ? sortedVendors.filter(v => v.nama.toLowerCase().includes(vendorQuery))
    : sortedVendors;

  const currentBeli = parseRp(form.hargaBeli);
  const currentJual = parseRp(form.hargaJual);
  const isBeliChanged = initialPrices.beli !== null && currentBeli !== initialPrices.beli;
  const isJualChanged = initialPrices.jual !== null && currentJual !== initialPrices.jual;

  function pickVendor(v: VendorOption) {
    setForm(prev => ({ ...prev, namaVendor: v.nama, hargaBeli: v.harga > 0 ? String(v.harga) : prev.hargaBeli }));
    if (v.harga > 0) setInitialPrices(prev => ({ ...prev, beli: v.harga }));
    setOpenDropdown(null);
  }

  function pickHistoris(harga: number) {
    handleChange("hargaJual", String(harga));
    setInitialPrices(prev => ({ ...prev, jual: harga }));
    setOpenDropdown(null);
  }

  async function submitNewVendor() {
    if (!newVendorForm.nama.trim()) return;
    const harga = Number(newVendorForm.harga) || 0;
    try {
      const created = await createVendor.mutateAsync({ name: newVendorForm.nama.trim() });
      const newVendor: VendorOption = { nama: created.name, harga, vendorId: created.id };
      setExtraVendors(prev => [...prev, newVendor]);
      setForm(prev => ({ ...prev, namaVendor: newVendor.nama, hargaBeli: harga > 0 ? String(harga) : prev.hargaBeli }));
      if (harga > 0) setInitialPrices(prev => ({ ...prev, beli: harga }));
      setShowVendorNew(false);
    } catch {
      // Surface persisted via mutation state.
    }
  }

  function pickProduct(item: CatalogItem) {
    setPickedItemId(item.id ?? null);
    if (item.defaultUnitId && units) {
      const unit = units.find(u => u.id === item.defaultUnitId);
      if (unit) setForm(prev => ({ ...prev, satuan: unit.code }));
    }
  }

  return (
    <>
      <div className="ca-overlay" onClick={handleCancel} style={{ display: showProductNew || showVendorNew ? "none" : undefined }}>
        <div className="ca-modal" onClick={e => e.stopPropagation()}>
          <div className="ca-header">
            <h2 className="ca-title">{initialData ? "Edit Produk Quotation" : "Tambah Produk ke Quotation"}</h2>
            <button className="ca-close-btn" onClick={handleCancel} title="Tutup">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="1" y1="1" x2="13" y2="13" />
                <line x1="13" y1="1" x2="1" y2="13" />
              </svg>
            </button>
          </div>

          <div className="ca-body">
            <IdentityCard
              form={form}
              onChange={handleChange}
              productCatalog={productCatalog}
              productMatches={productMatches}
              activeProductLabel={activeProductLabel}
              productOpen={productOpen}
              satuanOpen={satuanOpen}
              satuanOptions={satuanOptions}
              setOpenDropdown={setOpenDropdown}
              closeIfMatch={closeIfMatch}
              toggleDropdown={toggleDropdown}
              isProductFilled={isProductFilled}
              isSatuanFilled={isSatuanFilled}
              onAddProductNew={() => { setOpenDropdown(null); setShowProductNew(true); }}
              onPickProduct={pickProduct}
            />

            <VendorPriceCard
              form={form}
              onChange={handleChange}
              onPickVendor={pickVendor}
              onPickHistoris={pickHistoris}
              vendorMatches={vendorMatches}
              exactVendor={exactVendor}
              vendorOpen={vendorOpen}
              historisOpen={historisOpen}
              historisOptions={historisOptions}
              setOpenDropdown={setOpenDropdown}
              closeIfMatch={closeIfMatch}
              toggleDropdown={toggleDropdown}
              isJumlahFilled={isJumlahFilled}
              isVendorFilled={isVendorFilled}
              profit={profit}
              profitPct={profitPct}
              onAddVendorNew={() => { setOpenDropdown(null); setNewVendorForm({ nama: "", harga: "" }); setShowVendorNew(true); }}
            />
          </div>

          <div className="ca-footer">
            <button type="button" className="ca-btn-cancel" onClick={handleCancel}>Batal</button>
            <button type="button" className="ca-btn-submit" onClick={handlePreSubmit}>
              {initialData ? "Simpan Perubahan" : "Simpan Data"}
            </button>
          </div>
        </div>
      </div>

      <ProductCreateModal
        open={showProductNew}
        onOpenChange={setShowProductNew}
        onSuccess={data => {
          handleChange("kodeImpaNama", formatKodeNama(data.kode, data.nama));
          if (data.satuan) handleChange("satuan", data.satuan);
          setShowProductNew(false);
        }}
      />

      <VendorAddModal
        open={showVendorNew}
        form={newVendorForm}
        onChange={setNewVendorForm}
        onClose={() => setShowVendorNew(false)}
        onSubmit={submitNewVendor}
        isSaving={createVendor.isPending}
        error={createVendor.error instanceof Error ? createVendor.error.message : null}
      />

      <PriceConfirmModal
        open={showConfirm}
        onCancel={() => setShowConfirm(false)}
        onConfirm={executeSubmit}
        isBeliChanged={isBeliChanged}
        isJualChanged={isJualChanged}
        initialBeli={initialPrices.beli}
        initialJual={initialPrices.jual}
        currentBeli={currentBeli}
        currentJual={currentJual}
      />
    </>
  );
}
