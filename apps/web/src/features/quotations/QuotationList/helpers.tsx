import type { Status } from "@/features/quotations/types";

// Visual tokens per status.
export const statusConfig: Record<Status, { bg: string; color: string }> = {
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Dikirim:   { bg: "var(--status-dikirim-bg)",   color: "var(--status-dikirim-color)"   },
  Draf:      { bg: "var(--status-draf-bg)",       color: "var(--status-draf-color)"      },
  Revisi:    { bg: "var(--status-revisi-bg)",     color: "var(--status-revisi-color)"    },
  Ditolak:   { bg: "var(--status-ditolak-bg)",   color: "var(--status-ditolak-color)"   },
};

export interface QuotationRow {
  id: string;
  displayNo: string;
  version: number;
  client: string;
  date: string;
  hargaBeli: string;
  total: string;
  status: Status;
}

// Pagination ellipsis placeholder.
export function getPageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter(n => n >= 1 && n <= total),
  );
  const sorted = [...set].sort((a, b) => a - b);
  const pages: (number | null)[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) pages.push(null);
    pages.push(n);
    prev = n;
  }
  return pages;
}

// Tiny sort indicator icon.
export function SortIcon({ direction }: { direction?: "asc" | "desc" | null }) {
  return (
    <svg width="6" height="10" viewBox="0 0 6 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 0L5.598 3.5H0.402L3 0Z" fill={direction === "asc" ? "#630ED4" : "#4A4455"} />
      <path d="M3 10L0.402 6.5H5.598L3 10Z" fill={direction === "desc" ? "#630ED4" : "#4A4455"} />
    </svg>
  );
}
