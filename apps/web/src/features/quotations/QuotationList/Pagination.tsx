import { useState } from "react";
import { getPageNumbers } from "./helpers";

interface PaginationProps {
  totalItems: number;
  startIndex: number;
  itemsPerPage: number;
  currentPage: number;
  totalPages: number;
  onItemsPerPage: (n: number) => void;
  onPage: (n: number) => void;
}

// Rows-per-page picker plus nav.
export default function Pagination({
  totalItems,
  startIndex,
  itemsPerPage,
  currentPage,
  totalPages,
  onItemsPerPage,
  onPage,
}: PaginationProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pagination" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #E2E8F0",
              background: "#fff",
              cursor: "pointer",
              fontSize: "14px",
              color: "#4A4455",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {itemsPerPage} Baris
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path d="M1 1L5 5L9 1" stroke="#4A4455" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: 0,
                background: "#FFFFFF",
                border: "1px solid rgba(204, 195, 216, 0.2)",
                boxShadow: "0px 0px 0px 1px rgba(0, 0, 0, 0.05)",
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "8px 0px",
                width: "162px",
                zIndex: 50,
                boxSizing: "border-box",
              }}
            >
              {[5, 10, 15].map(val => {
                const isActive = itemsPerPage === val;
                return (
                  <button
                    key={val}
                    onClick={() => {
                      onItemsPerPage(val);
                      setOpen(false);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      justifyContent: isActive ? "space-between" : "flex-start",
                      alignItems: "center",
                      padding: "4px 20px",
                      width: "100%",
                      height: "32px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: isActive ? 600 : 400,
                        fontSize: "12px",
                        lineHeight: "24px",
                        color: isActive ? "#630ED4" : "#4A4455",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {val} Baris
                    </span>
                    {isActive && (
                      <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                        <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="pagination-info">
          Menampilkan {totalItems === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + itemsPerPage, totalItems)} dari {totalItems} Quotation
        </span>
      </div>

      <div className="page-buttons">
        <button className="page-btn-nav" onClick={() => onPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
            <path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {getPageNumbers(currentPage, totalPages).map((n, i) =>
          n === null ? (
            <span key={`e${i}`} style={{ padding: "0 2px", color: "#9CA3AF", fontSize: "13px", alignSelf: "center", userSelect: "none" }}>
              …
            </span>
          ) : (
            <button key={n} onClick={() => onPage(n)} className={`page-btn${n === currentPage ? " page-btn--active" : ""}`}>
              {n}
            </button>
          ),
        )}
        <button
          className="page-btn-nav"
          onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages || totalPages === 0}
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
            <path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
