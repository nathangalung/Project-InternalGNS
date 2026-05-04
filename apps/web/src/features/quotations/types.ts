export type Status = "Disetujui" | "Dikirim" | "Draf" | "Revisi" | "Ditolak";

export interface ClientInfo {
  narahubung?: string;
  phone?: string;
  email?: string;
  nomorTKU?: string;
  referenceNumber?: string;
  npwp?: string;
  lokasi?: string;
}

export interface ProductRow {
  kode: string;
  nama: string;
  qty: number;
  satuan: string;
  hargaSatuan: number;
  profitSatuan: number;
  vendor?: string;
}

export interface ShippingRow {
  nama: string;
  deadline: string;
  hargaSatuan: number;
  alamat?: string;
  hari?: number;
}

interface HistoryEntry {
  date: string;
  action: string;
}

export interface QuotationData {
  id: string;
  version: number;
  client: string;
  clientInfo?: ClientInfo;
  createdAt: string;
  status: Status;
  totalBayar: number;
  discountPct?: number;
  products: ProductRow[];
  shipping: ShippingRow;
  history: HistoryEntry[];
}

// Indonesian rupiah string.
export function formatRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

// Grand total with tax.
export function computeGrandTotal(q: QuotationData): number {
  const hasProducts = q.products.length > 0;
  const totalProduk = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0);
  const diskon = totalProduk * ((q.discountPct ?? 0) / 100);
  const subTotal = totalProduk - diskon;
  const totalShip = q.shipping.hargaSatuan;
  const dppBase = hasProducts ? subTotal : totalShip;
  const dpp = Math.round((dppBase * 11) / 12);
  const ppn = Math.round(dpp * 0.12);
  return hasProducts ? subTotal + ppn + totalShip : totalShip + ppn;
}
