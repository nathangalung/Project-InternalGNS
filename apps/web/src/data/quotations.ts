export type Status = "Disetujui" | "Dikirim" | "Draf" | "Revisi" | "Ditolak";

export interface ProductRow {
  kode: string;
  nama: string;
  qty: number;
  satuan: string;
  hargaSatuan: number;
  profitSatuan: number;
}

export interface ShippingRow {
  nama: string;
  deadline: string;
  hargaSatuan: number;
}

export interface HistoryEntry {
  date: string;
  action: string;
}

export interface QuotationData {
  id: string;
  version: number;
  client: string;
  createdAt: string;
  status: Status;
  totalBayar: number;
  products: ProductRow[];
  shipping: ShippingRow;
  history: HistoryEntry[];
}

export const quotations: QuotationData[] = [
  {
    id: "Q-264128/GNS/IV/2026", version: 1, client: "PT Astra Modern",
    createdAt: "02 Apr 2026, 10:00 WIB", status: "Disetujui", totalBayar: 450000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 24, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty: 10, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",          qty: 28, satuan: "UNT", hargaSatuan: 3587500,  profitSatuan: 617000  },
      { kode: "223341", nama: "Bearing Marine SKF 6208",            qty:  4, satuan: "PCS", hargaSatuan: 1250000,  profitSatuan: 180000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "23 Apr 2026", hargaSatuan: 3587500 },
    history: [
      { date: "02 Apr 2026, 10:00", action: "Draf dibuat oleh Admin" },
      { date: "03 Apr 2026, 09:15", action: "Status diubah menjadi Dikirim" },
      { date: "04 Apr 2026, 11:30", action: "Status disetujui secara resmi oleh Klien" },
    ],
  },
  {
    id: "Q-264129/GNS/IV/2026", version: 1, client: "PT Telkom Prakarsa",
    createdAt: "04 Apr 2026, 09:30 WIB", status: "Dikirim", totalBayar: 30000000,
    products: [
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty: 1, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "223341", nama: "Bearing Marine SKF 6208",            qty: 4, satuan: "PCS", hargaSatuan: 1250000,  profitSatuan: 180000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "18 Apr 2026", hargaSatuan: 1800000 },
    history: [
      { date: "04 Apr 2026, 09:30", action: "Draf dibuat oleh Admin" },
      { date: "05 Apr 2026, 14:00", action: "Status diubah menjadi Dikirim" },
    ],
  },
  {
    id: "Q-264130/GNS/IV/2026", version: 1, client: "Bank Loka Mandiri",
    createdAt: "05 Apr 2026, 11:00 WIB", status: "Draf", totalBayar: 10000000,
    products: [
      { kode: "223341", nama: "Bearing Marine SKF 6208", qty: 5, satuan: "PCS", hargaSatuan: 1250000, profitSatuan: 180000 },
      { kode: "441205", nama: "Valve Gate Marine 4\"",   qty: 1, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000 },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "20 Apr 2026", hargaSatuan: 800000 },
    history: [
      { date: "05 Apr 2026, 11:00", action: "Draf dibuat oleh Admin" },
    ],
  },
  {
    id: "Q-264131/GNS/IV/2026", version: 1, client: "PT Astra Modern",
    createdAt: "08 Apr 2026, 08:45 WIB", status: "Revisi", totalBayar: 80000000,
    products: [
      { kode: "556612", nama: "Pump Impeller Set (Marine)", qty: 7, satuan: "SET", hargaSatuan: 8750000, profitSatuan: 950000 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)", qty: 3, satuan: "UNT", hargaSatuan: 3587500, profitSatuan: 617000 },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "25 Apr 2026", hargaSatuan: 2500000 },
    history: [
      { date: "08 Apr 2026, 08:45", action: "Draf dibuat oleh Admin" },
      { date: "09 Apr 2026, 10:00", action: "Status diubah menjadi Dikirim" },
      { date: "10 Apr 2026, 15:30", action: "Status diubah menjadi Revisi oleh Klien" },
    ],
  },
  {
    id: "Q-264132/GNS/IV/2026", version: 1, client: "Global Network",
    createdAt: "10 Apr 2026, 13:00 WIB", status: "Ditolak", totalBayar: 70000000,
    products: [
      { kode: "556612", nama: "Pump Impeller Set (Marine)", qty: 6, satuan: "SET", hargaSatuan: 8750000, profitSatuan: 950000 },
      { kode: "441205", nama: "Valve Gate Marine 4\"",      qty: 3, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000 },
      { kode: "223341", nama: "Bearing Marine SKF 6208",    qty: 4, satuan: "PCS", hargaSatuan: 1250000, profitSatuan: 180000 },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "28 Apr 2026", hargaSatuan: 1500000 },
    history: [
      { date: "10 Apr 2026, 13:00", action: "Draf dibuat oleh Admin" },
      { date: "11 Apr 2026, 09:00", action: "Status diubah menjadi Dikirim" },
      { date: "12 Apr 2026, 16:00", action: "Penawaran ditolak oleh Klien" },
    ],
  },
  {
    id: "Q-264133/GNS/IV/2026", version: 2, client: "Indo Food Group",
    createdAt: "12 Apr 2026, 10:30 WIB", status: "Disetujui", totalBayar: 55000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 4, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty: 1, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",          qty: 2, satuan: "UNT", hargaSatuan: 3587500,  profitSatuan: 617000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "30 Apr 2026", hargaSatuan: 1500000 },
    history: [
      { date: "12 Apr 2026, 10:30", action: "Draf dibuat oleh Admin" },
      { date: "13 Apr 2026, 11:00", action: "Status diubah menjadi Dikirim" },
      { date: "14 Apr 2026, 09:00", action: "Status disetujui secara resmi oleh Klien" },
    ],
  },
  {
    id: "Q-264134/GNS/IV/2026", version: 1, client: "Tech Solutions",
    createdAt: "14 Apr 2026, 14:00 WIB", status: "Dikirim", totalBayar: 120000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 10, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty:  2, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "441205", nama: "Valve Gate Marine 4\"",              qty:  4, satuan: "UNT", hargaSatuan: 2000000,  profitSatuan: 280000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "02 Mei 2026", hargaSatuan: 2500000 },
    history: [
      { date: "14 Apr 2026, 14:00", action: "Draf dibuat oleh Admin" },
      { date: "15 Apr 2026, 10:00", action: "Status diubah menjadi Dikirim" },
    ],
  },
  {
    id: "Q-264135/GNS/IV/2026", version: 1, client: "Mandiri Finance",
    createdAt: "15 Apr 2026, 09:00 WIB", status: "Draf", totalBayar: 25000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element", qty: 2, satuan: "PCS", hargaSatuan: 6587500, profitSatuan: 1581000 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",    qty: 2, satuan: "UNT", hargaSatuan: 3587500, profitSatuan: 617000  },
      { kode: "441205", nama: "Valve Gate Marine 4\"",        qty: 1, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "05 Mei 2026", hargaSatuan: 800000 },
    history: [
      { date: "15 Apr 2026, 09:00", action: "Draf dibuat oleh Admin" },
    ],
  },
  {
    id: "Q-264136/GNS/IV/2026", version: 3, client: "Surya Kencana",
    createdAt: "16 Apr 2026, 11:30 WIB", status: "Disetujui", totalBayar: 310000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element",       qty: 15, satuan: "PCS", hargaSatuan: 6587500,  profitSatuan: 1581000 },
      { kode: "590741", nama: "Oli Hidrolik Kelas Industri (200L)", qty:  8, satuan: "DRM", hargaSatuan: 18523300, profitSatuan: 1834400 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",          qty: 10, satuan: "UNT", hargaSatuan: 3587500,  profitSatuan: 617000  },
      { kode: "556612", nama: "Pump Impeller Set (Marine)",         qty:  3, satuan: "SET", hargaSatuan: 8750000,  profitSatuan: 950000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "08 Mei 2026", hargaSatuan: 3587500 },
    history: [
      { date: "16 Apr 2026, 11:30", action: "Draf dibuat oleh Admin" },
      { date: "17 Apr 2026, 09:00", action: "Status diubah menjadi Dikirim" },
      { date: "18 Apr 2026, 14:00", action: "Status diubah menjadi Revisi oleh Klien" },
      { date: "19 Apr 2026, 10:00", action: "Status disetujui secara resmi oleh Klien" },
    ],
  },
  {
    id: "Q-264137/GNS/IV/2026", version: 1, client: "Delta Logistik",
    createdAt: "17 Apr 2026, 15:00 WIB", status: "Revisi", totalBayar: 45000000,
    products: [
      { kode: "330212", nama: "Marine Engine Filter Element", qty: 4, satuan: "PCS", hargaSatuan: 6587500, profitSatuan: 1581000 },
      { kode: "626718", nama: "Shackle Tugas Berat (M42)",    qty: 3, satuan: "UNT", hargaSatuan: 3587500, profitSatuan: 617000  },
      { kode: "441205", nama: "Valve Gate Marine 4\"",        qty: 2, satuan: "UNT", hargaSatuan: 2000000, profitSatuan: 280000  },
    ],
    shipping: { nama: "Pengiriman Barang", deadline: "10 Mei 2026", hargaSatuan: 1500000 },
    history: [
      { date: "17 Apr 2026, 15:00", action: "Draf dibuat oleh Admin" },
      { date: "18 Apr 2026, 11:00", action: "Status diubah menjadi Dikirim" },
      { date: "19 Apr 2026, 16:00", action: "Status diubah menjadi Revisi oleh Klien" },
    ],
  },
];

export function getQuotation(id: string): QuotationData | undefined {
  return quotations.find((q) => q.id === id);
}

export function getTotalHargaBeli(q: QuotationData): number {
  return q.products.reduce((sum, p) => sum + p.qty * (p.hargaSatuan - p.profitSatuan), 0);
}

export function formatRp(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}
