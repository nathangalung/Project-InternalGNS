import type { ReactNode } from "react"

const stateCell = "py-10 text-center text-sm text-dark-500"

// Placeholder row while the list loads.
export function TableLoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className={stateCell}>
        Memuat data…
      </td>
    </tr>
  )
}

// Placeholder row when the list is empty.
export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={stateCell}>
        {children}
      </td>
    </tr>
  )
}
