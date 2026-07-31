import { useState } from "react"
import { getPageNumbers } from "@/lib/pagination"

interface PaginationProps {
  totalItems: number
  startIndex: number
  itemsPerPage: number
  currentPage: number
  totalPages: number
  resourceLabel: string
  rowsPerPageOptions?: number[]
  onItemsPerPage: (n: number) => void
  onPage: (n: number) => void
}

const pageBtnBase = "flex h-8 w-8 items-center justify-center rounded-sm text-sm transition"
const navBtn =
  "flex items-center justify-center rounded-sm border border-[#CCC3D8] p-2 transition hover:bg-dark-100"

// Pagination footer with page picker.
export default function Pagination({
  totalItems,
  startIndex,
  itemsPerPage,
  currentPage,
  totalPages,
  resourceLabel,
  rowsPerPageOptions = [5, 10, 15],
  onItemsPerPage,
  onPage,
}: PaginationProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col items-center gap-4 border-t border-dark-200 p-6 sm:flex-row sm:justify-between sm:gap-0">
      <div className="flex items-center gap-3">
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-center justify-between gap-2 rounded-sm border border-dark-200 bg-white px-3 py-1.5 text-sm leading-6 text-[#4A4455]"
          >
            {itemsPerPage} Baris
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path
                d="M1 1L5 5L9 1"
                stroke="#4A4455"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {open && (
            <div className="absolute bottom-[calc(100%_+_8px)] left-0 z-50 flex w-[162px] flex-col items-start rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.05)]">
              {rowsPerPageOptions.map((val) => {
                const isActive = itemsPerPage === val
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      onItemsPerPage(val)
                      setOpen(false)
                    }}
                    className={`flex h-8 w-full flex-row items-center px-5 py-1 ${
                      isActive ? "justify-between" : "justify-start"
                    }`}
                  >
                    <span
                      className={`flex items-center text-[12px] leading-6 ${
                        isActive ? "font-semibold text-[#630ED4]" : "font-normal text-[#4A4455]"
                      }`}
                    >
                      {val} Baris
                    </span>
                    {isActive && (
                      <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                        <path
                          d="M1 5.5L4.5 9L13 1"
                          stroke="#630ED4"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <span className="text-sm text-[#4A4455]">
          Menampilkan {totalItems === 0 ? 0 : startIndex + 1}-
          {Math.min(startIndex + itemsPerPage, totalItems)} dari {totalItems} {resourceLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1 sm:flex-nowrap sm:justify-start">
        <button
          type="button"
          className={navBtn}
          onClick={() => onPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
            <path
              d="M4 1L1 4L4 7"
              stroke="#191C1E"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {getPageNumbers(currentPage, totalPages).map((n, i) =>
          n === null ? (
            <span
              key={`e${i}`}
              className="select-none self-center px-[2px] text-[13px] text-[#9CA3AF]"
            >
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPage(n)}
              className={`${pageBtnBase} ${
                n === currentPage
                  ? "bg-primary-700 font-bold text-white"
                  : "font-medium text-[#4A4455] hover:bg-dark-100"
              }`}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          className={navBtn}
          onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages || totalPages === 0}
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
            <path
              d="M1 1L4 4L1 7"
              stroke="#191C1E"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
