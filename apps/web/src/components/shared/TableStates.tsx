import type { ReactNode } from "react"

const stateCell = "py-10 text-center text-sm text-dark-500"

// Loading placeholder row.
export function TableLoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className={stateCell}>
        Memuat data…
      </td>
    </tr>
  )
}

// Empty-list placeholder row.
export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={stateCell}>
        {children}
      </td>
    </tr>
  )
}
