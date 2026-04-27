import { useMemo, useState } from "react";
import type { Page } from "@/main";
import Sidebar from "@/components/shared/Sidebar";
import QuotationFilter, { type DatePreset, type StatusFilter } from "../QuotationFilter";

import PageHeader from "./PageHeader";
import SummaryCards from "./SummaryCards";
import SearchBar from "./SearchBar";
import QuotationTable from "./QuotationTable";
import Pagination from "./Pagination";
import type { QuotationRow } from "./helpers";

interface QuotationListProps {
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  onViewDetail?: (id: string) => void;
  rows?: QuotationRow[];
}

interface ActiveFilters {
  preset: DatePreset;
  statuses: StatusFilter[];
  minHarga: string;
  maxHarga: string;
}

// Quotation list orchestrator.
export default function QuotationList({ onNavigate, onLogout, onViewDetail, rows }: QuotationListProps) {
  const tableData: QuotationRow[] = rows ?? [];

  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState<{ key: keyof QuotationRow; direction: "asc" | "desc" } | null>(null);

  function requestSort(key: keyof QuotationRow) {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  }

  // Apply search, filters, sort.
  const processedData = useMemo(() => {
    let items = [...tableData];

    if (search) {
      const needle = search.toLowerCase();
      items = items.filter(it => it.client.toLowerCase().includes(needle) || it.displayNo.toLowerCase().includes(needle));
    }

    if (activeFilters && activeFilters.statuses.length > 0) {
      items = items.filter(it => activeFilters.statuses.includes(it.status));
    }

    if (activeFilters) {
      const min = parseInt(activeFilters.minHarga.replace(/\./g, "")) || 0;
      const max = parseInt(activeFilters.maxHarga.replace(/\./g, "")) || Infinity;
      items = items.filter(it => {
        const total = parseInt(it.total.replace(/[^0-9]/g, ""));
        return total >= min && total <= max;
      });
    }

    if (activeFilters && activeFilters.preset !== "kustom") {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      if (activeFilters.preset === "7-hari") start.setDate(start.getDate() - 7);
      if (activeFilters.preset === "30-hari") start.setDate(start.getDate() - 30);
      items = items.filter(it => {
        const d = new Date(it.date);
        return d >= start && d <= today;
      });
    }

    if (sortConfig !== null) {
      items.sort((a, b) => {
        let aValue: string | number = a[sortConfig.key] as string | number;
        let bValue: string | number = b[sortConfig.key] as string | number;

        if (sortConfig.key === "total") {
          aValue = parseInt(String(aValue).replace(/[^0-9]/g, ""));
          bValue = parseInt(String(bValue).replace(/[^0-9]/g, ""));
        } else if (sortConfig.key === "date") {
          aValue = new Date(String(aValue)).getTime();
          bValue = new Date(String(bValue)).getTime();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return items;
  }, [search, sortConfig, activeFilters, tableData]);

  const totalItems = processedData.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = processedData.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          <PageHeader onNavigate={onNavigate} />
          <SummaryCards />
          <SearchBar
            search={search}
            onSearch={v => {
              setSearch(v);
              setCurrentPage(1);
            }}
            onOpenFilter={() => setShowFilter(true)}
          />

          <div className="tbl-container">
            <QuotationTable
              rows={currentData}
              sortKey={sortConfig?.key ?? null}
              sortDir={sortConfig?.direction ?? null}
              onSort={requestSort}
              onViewDetail={onViewDetail}
            />
            <Pagination
              totalItems={totalItems}
              startIndex={startIndex}
              itemsPerPage={itemsPerPage}
              currentPage={currentPage}
              totalPages={totalPages}
              onItemsPerPage={n => {
                setItemsPerPage(n);
                setCurrentPage(1);
              }}
              onPage={setCurrentPage}
            />
          </div>
        </div>
      </div>

      {showFilter && (
        <QuotationFilter
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={filters => {
            setActiveFilters(filters);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}
