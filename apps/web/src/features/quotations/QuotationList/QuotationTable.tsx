import { type QuotationRow, SortIcon, statusConfig } from "./helpers";

interface QuotationTableProps {
  rows: QuotationRow[];
  sortKey: keyof QuotationRow | null;
  sortDir: "asc" | "desc" | null;
  onSort: (key: keyof QuotationRow) => void;
  onViewDetail?: (id: string) => void;
}

// Sortable rows with action buttons.
export default function QuotationTable({ rows, sortKey, sortDir, onSort, onViewDetail }: QuotationTableProps) {
  const dirOf = (key: keyof QuotationRow) => (sortKey === key ? sortDir : null);
  return (
    <table className="tbl">
      <thead>
        <tr className="tbl-header-row">
          <th className="tbl-th tbl-th--center" style={{ width: 160, cursor: "pointer" }} onClick={() => onSort("displayNo")}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <span>Nomor Quotation</span>
              <SortIcon direction={dirOf("displayNo")} />
            </div>
          </th>
          <th className="tbl-th tbl-th--center" style={{ width: 70, cursor: "pointer" }} onClick={() => onSort("version")}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <span>Versi</span>
              <SortIcon direction={dirOf("version")} />
            </div>
          </th>
          <th className="tbl-th tbl-th--center" style={{ width: 170 }}>Nama Klien</th>
          <th className="tbl-th tbl-th--center" style={{ width: 120, cursor: "pointer" }} onClick={() => onSort("date")}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <span>Tanggal</span>
              <SortIcon direction={dirOf("date")} />
            </div>
          </th>
          <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Total Harga Beli</th>
          <th className="tbl-th tbl-th--center" style={{ width: 160, cursor: "pointer" }} onClick={() => onSort("total")}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <span>Total Penawaran</span>
              <SortIcon direction={dirOf("total")} />
            </div>
          </th>
          <th className="tbl-th tbl-th--center" style={{ width: 120 }}>Status</th>
          <th className="tbl-th tbl-th--center" style={{ width: 80 }}>Aksi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const badge = statusConfig[row.status];
          return (
            <tr key={row.id} className="tbl-row">
              <td className="tbl-td tbl-td--id tbl-td--center">{row.displayNo}</td>
              <td className="tbl-td tbl-td--center">{row.version}</td>
              <td className="tbl-td tbl-td--client tbl-td--center">{row.client}</td>
              <td className="tbl-td tbl-td--center">{row.date}</td>
              <td className="tbl-td tbl-td--center">{row.hargaBeli}</td>
              <td className="tbl-td tbl-td--total tbl-td--center">{row.total}</td>
              <td className="tbl-td tbl-td--center">
                <span className="status-badge" style={{ background: badge.bg, color: badge.color }}>
                  {row.status}
                </span>
              </td>
              <td className="tbl-td tbl-td--center">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
                  <button className="action-btn" title="Lihat" onClick={() => onViewDetail?.(row.id)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button className="action-btn" title="Download">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
