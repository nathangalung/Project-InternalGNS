import type { ReactNode } from "react"
import SearchCombobox, { messageCls } from "@/components/shared/SearchCombobox"
import { useUnits } from "@/features/units/hooks"
import type { UnitRow } from "@/types/api"
import { matchUnits, unitLabel } from "./match"

type UnitComboboxProps = {
  // Picked unit code, "" for none
  code: string
  onCodeChange: (code: string) => void
  query: string
  onQueryChange: (query: string) => void
  inputClassName: string
  panelClassName?: string
  inputId?: string
  placeholder?: string
  "aria-labelledby"?: string
  readOnly?: boolean
  leading?: ReactNode
}

// Unit picker by code or name.
//
// The input shows the code once picked, as the hand-built pickers did.
export default function UnitCombobox({
  code,
  onCodeChange,
  query,
  onQueryChange,
  ...field
}: UnitComboboxProps) {
  const { data: units } = useUnits()
  const all = units ?? []
  return (
    <SearchCombobox<UnitRow>
      items={matchUnits(all, query)}
      value={all.find((u) => u.code === code) ?? null}
      onValueChange={(u) => onCodeChange(u?.code ?? "")}
      query={query}
      onQueryChange={onQueryChange}
      itemKey={(u) => u.id}
      itemToString={(u) => u.code}
      renderItem={unitLabel}
      clearLabel="Bersihkan satuan"
      empty={<div className={messageCls}>Tidak ada hasil</div>}
      {...field}
    />
  )
}
