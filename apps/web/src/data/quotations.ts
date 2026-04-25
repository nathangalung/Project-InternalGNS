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

export interface HistoryEntry {
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

export const quotations: QuotationData[] = [
  {
    id: "Q-264128/GNS/IV/2026", version: 1, client: "PT Astra Modern",
    clientInfo: { narahubung: "Budi Santoso", phone: "+62 812-3456-7890", email: "budi@astramodern.co.id", nomorTKU: "100210293840001", referenceNumber: "15823991992", npwp: "01.234.567.8-091.000", lokasi: "Jl. Gaya Motor Raya No.8, Jakarta Utara 14330" },
    createdAt: "02 Apr 2026, 10:00 WIB", status: "Disetujui", totalBayar: 450000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 24, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000, vendor: "PT Bahari Teknik"    },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty: 10, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400, vendor: "CV Pelumas Nusantara" },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",          qty: 28, satuan: "UNT", hargaSatuan: 3587500,  profitSatuan: 617000,  vendor: "PT Besi Kuat"        },
      { kode: "223341", nama: "Bearing Marine SKF 6208",            qty:  4, satuan: "PCS", hargaSatuan: 1250000,  profitSatuan: 180000,  vendor: "PT Surya Bearing"    },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "23 Apr 2026", hargaSatuan: 3587500, alamat: "Jalan Rasuna Said, Kecamatan Jakarta Selatan, JKT 14230", hari: 3 },
    history: [
      { date: "02 Apr 2026, 10:00", action: "Status diubah menjadi Draf" },
      { date: "03 Apr 2026, 09:15", action: "Status diubah menjadi Dikirim" },
      { date: "04 Apr 2026, 11:30", action: "Status diubah menjadi Disetujui" },
    ],
  },
  {
    id: "Q-264129/GNS/IV/2026", version: 1, client: "PT Telkom Prakarsa",
    clientInfo: { narahubung: "Siti Rahayu", phone: "+62 821-9876-5432", email: "siti@telkomprakarsa.co.id", nomorTKU: "200319482930002", referenceNumber: "28491029384", npwp: undefined, lokasi: "Jl. Gatot Subroto Kav. 52, Jakarta Selatan 12710" },
    createdAt: "04 Apr 2026, 09:30 WIB", status: "Dikirim", totalBayar: 30000000,
    products: [
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty: 1, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "223341", nama: "Bearing Marine SKF 6208",            qty: 4, satuan: "PCS", hargaSatuan: 1250000,  profitSatuan: 180000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "18 Apr 2026", hargaSatuan: 1800000 },
    history: [
      { date: "04 Apr 2026, 09:30", action: "Status diubah menjadi Draf" },
      { date: "05 Apr 2026, 14:00", action: "Status diubah menjadi Dikirim" },
    ],
  },
  {
    id: "Q-264130/GNS/IV/2026", version: 1, client: "Bank Loka Mandiri",
    clientInfo: { narahubung: "Ahmad Hidayat", phone: "+62 857-1234-5678", email: "ahmad@lokmandiri.co.id", nomorTKU: undefined, referenceNumber: undefined, npwp: undefined, lokasi: "Jl. Sudirman No. 24, Jakarta Pusat 10220" },
    createdAt: "05 Apr 2026, 11:00 WIB", status: "Draf", totalBayar: 10000000,
    products: [
      { kode: "223341", nama: "Bearing Marine SKF 6208", qty: 5, satuan: "PCS", hargaSatuan: 1250000, profitSatuan: 180000 },
      { kode: "441205", nama: "Valve Gate Marine 4\"",   qty: 1, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000 },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "20 Apr 2026", hargaSatuan: 800000 },
    history: [
      { date: "05 Apr 2026, 11:00", action: "Status diubah menjadi Draf" },
    ],
  },
  {
    id: "Q-264131/GNS/IV/2026", version: 1, client: "PT Astra Modern",
    clientInfo: { narahubung: "Budi Santoso", phone: "+62 812-3456-7890", email: "budi@astramodern.co.id", nomorTKU: "100210293840001", referenceNumber: "15823991992", npwp: "01.234.567.8-091.000", lokasi: "Jl. Gaya Motor Raya No.8, Jakarta Utara 14330" },
    createdAt: "08 Apr 2026, 08:45 WIB", status: "Revisi", totalBayar: 80000000,
    products: [
      { kode: "556612", nama: "Pump Impeller Set (Marine)", qty: 7, satuan: "SET", hargaSatuan: 8750000, profitSatuan: 950000 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)", qty: 3, satuan: "UNT", hargaSatuan: 3587500, profitSatuan: 617000 },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "25 Apr 2026", hargaSatuan: 2500000 },
    history: [
      { date: "08 Apr 2026, 08:45", action: "Status diubah menjadi Draf" },
      { date: "09 Apr 2026, 10:00", action: "Status diubah menjadi Dikirim" },
      { date: "10 Apr 2026, 15:30", action: "Status diubah menjadi Revisi" },
    ],
  },
  {
    id: "Q-264132/GNS/IV/2026", version: 1, client: "Global Network",
    clientInfo: { narahubung: "Dewi Lestari", phone: "+62 813-5678-9012", email: "dewi@globalnetwork.co.id", nomorTKU: undefined, referenceNumber: "39201029384", npwp: "04.567.890.1-234.000", lokasi: "Jl. M.H. Thamrin No. 9, Jakarta Pusat 10340" },
    createdAt: "10 Apr 2026, 13:00 WIB", status: "Ditolak", totalBayar: 70000000,
    products: [
      { kode: "556612", nama: "Pump Impeller Set (Marine)", qty: 6, satuan: "SET", hargaSatuan: 8750000, profitSatuan: 950000 },
      { kode: "441205", nama: "Valve Gate Marine 4\"",      qty: 3, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000 },
      { kode: "223341", nama: "Bearing Marine SKF 6208",    qty: 4, satuan: "PCS", hargaSatuan: 1250000, profitSatuan: 180000 },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "28 Apr 2026", hargaSatuan: 1500000 },
    history: [
      { date: "10 Apr 2026, 13:00", action: "Status diubah menjadi Draf" },
      { date: "11 Apr 2026, 09:00", action: "Status diubah menjadi Dikirim" },
      { date: "12 Apr 2026, 16:00", action: "Status diubah menjadi Ditolak" },
    ],
  },
  {
    id: "Q-264133/GNS/IV/2026", version: 2, client: "Indo Food Group",
    clientInfo: { narahubung: "Rudi Hartono", phone: "+62 878-2345-6789", email: "rudi@indofoodgroup.co.id", nomorTKU: "500512938471005", referenceNumber: "48291038475", npwp: "05.678.901.2-345.000", lokasi: "Jl. Jend. Sudirman Kav. 76, Jakarta Selatan 12910" },
    createdAt: "12 Apr 2026, 10:30 WIB", status: "Disetujui", totalBayar: 55000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 4, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty: 1, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",          qty: 2, satuan: "UNT", hargaSatuan: 3587500,  profitSatuan: 617000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "30 Apr 2026", hargaSatuan: 1500000 },
    history: [
      { date: "12 Apr 2026, 10:30", action: "Status diubah menjadi Draf" },
      { date: "13 Apr 2026, 11:00", action: "Status diubah menjadi Dikirim" },
      { date: "14 Apr 2026, 09:00", action: "Status diubah menjadi Disetujui" },
    ],
  },
  {
    id: "Q-264134/GNS/IV/2026", version: 1, client: "Tech Solutions",
    clientInfo: { narahubung: "Linda Wijaya", phone: "+62 856-3456-7890", email: "linda@techsolutions.co.id", nomorTKU: "600619273640006", referenceNumber: "57382910293", npwp: undefined, lokasi: "Jl. TB Simatupang No. 57, Jakarta Selatan 12430" },
    createdAt: "14 Apr 2026, 14:00 WIB", status: "Dikirim", totalBayar: 120000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 10, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty:  2, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "441205", nama: "Valve Gate Marine 4\"",              qty:  4, satuan: "UNT", hargaSatuan: 2000000,  profitSatuan: 280000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "02 Mei 2026", hargaSatuan: 2500000 },
    history: [
      { date: "14 Apr 2026, 14:00", action: "Status diubah menjadi Draf" },
      { date: "15 Apr 2026, 10:00", action: "Status diubah menjadi Dikirim" },
    ],
  },
  {
    id: "Q-264135/GNS/IV/2026", version: 1, client: "Mandiri Finance",
    clientInfo: { narahubung: "Andi Pratama", phone: "+62 819-4567-8901", email: "andi@mandirifinance.co.id", nomorTKU: "700728364750007", referenceNumber: "66473829102", npwp: "07.890.123.4-567.000", lokasi: "Jl. Imam Bonjol No. 61, Jakarta Pusat 10310" },
    createdAt: "15 Apr 2026, 09:00 WIB", status: "Draf", totalBayar: 25000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element", qty: 2, satuan: "PCS", hargaSatuan: 6587500, profitSatuan: 1581000 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",    qty: 2, satuan: "UNT", hargaSatuan: 3587500, profitSatuan: 617000  },
      { kode: "441205", nama: "Valve Gate Marine 4\"",        qty: 1, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "05 Mei 2026", hargaSatuan: 800000 },
    history: [
      { date: "15 Apr 2026, 09:00", action: "Status diubah menjadi Draf" },
    ],
  },
  {
    id: "Q-264136/GNS/IV/2026", version: 3, client: "Surya Kencana",
    clientInfo: { narahubung: "Maya Kusuma", phone: "+62 895-5678-9012", email: "maya@suryakencana.co.id", nomorTKU: "800837455860008", referenceNumber: "75564738291", npwp: "08.901.234.5-678.000", lokasi: "Jl. Raya Kebayoran Lama No. 234, Jakarta Selatan 12220" },
    createdAt: "16 Apr 2026, 11:30 WIB", status: "Disetujui", totalBayar: 310000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 15, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty:  8, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",          qty: 10, satuan: "UNT", hargaSatuan: 3587500,  profitSatuan: 617000  },
      { kode: "556612", nama: "Pump Impeller Set (Marine)",         qty:  3, satuan: "SET", hargaSatuan: 8750000,  profitSatuan: 950000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "08 Mei 2026", hargaSatuan: 3587500 },
    history: [
      { date: "16 Apr 2026, 11:30", action: "Status diubah menjadi Draf" },
      { date: "17 Apr 2026, 09:00", action: "Status diubah menjadi Dikirim" },
      { date: "18 Apr 2026, 14:00", action: "Status diubah menjadi Revisi" },
      { date: "19 Apr 2026, 10:00", action: "Status diubah menjadi Disetujui" },
    ],
  },
  {
    id: "Q-264137/GNS/IV/2026", version: 1, client: "Delta Logistik",
    clientInfo: { narahubung: "Bambang Sutrisno", phone: "+62 852-6789-0123", email: "bambang@deltalogistik.co.id", nomorTKU: undefined, referenceNumber: undefined, npwp: undefined, lokasi: "Jl. Raya Cakung No. 88, Jakarta Timur 13910" },
    createdAt: "17 Apr 2026, 15:00 WIB", status: "Revisi", totalBayar: 45000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element", qty: 4, satuan: "PCS", hargaSatuan: 6587500, profitSatuan: 1581000 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",    qty: 3, satuan: "UNT", hargaSatuan: 3587500, profitSatuan: 617000  },
      { kode: "441205", nama: "Valve Gate Marine 4\"",        qty: 2, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "10 Mei 2026", hargaSatuan: 1500000 },
    history: [
      { date: "17 Apr 2026, 15:00", action: "Status diubah menjadi Draf" },
      { date: "18 Apr 2026, 11:00", action: "Status diubah menjadi Dikirim" },
      { date: "19 Apr 2026, 16:00", action: "Status diubah menjadi Revisi" },
    ],
  },
];

export function getQuotation(id: string): QuotationData | undefined {
  return quotations.find((q) => q.id === id);
}

export function getTotalHargaBeli(q: QuotationData): number {
  return q.products.reduce((sum, p) => sum + p.qty * (p.hargaSatuan - p.profitSatuan), 0);
}

export function computeGrandTotal(q: QuotationData): number {
  const hasProducts = q.products.length > 0;
  const totalProduk = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0);
  const diskon = totalProduk * ((q.discountPct ?? 0) / 100);
  const subTotal = totalProduk - diskon;
  const totalShip = q.shipping.hargaSatuan;
  const dppBase = hasProducts ? subTotal : totalShip;
  const dpp = Math.round(dppBase * 11 / 12);
  const ppn = dppBase - dpp;
  return hasProducts ? subTotal + ppn + totalShip : totalShip + ppn;
}

export function updateQuotation(id: string, updates: Partial<QuotationData>): void {
  const idx = quotations.findIndex(q => q.id === id);
  if (idx !== -1) quotations[idx] = { ...quotations[idx], ...updates };
}

export function formatRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}
