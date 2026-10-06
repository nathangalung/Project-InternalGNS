import { useState } from "react"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import SearchCombobox, { messageCls } from "@/components/shared/SearchCombobox"
import { useCountries } from "@/features/countries/hooks"
import { matchCountries } from "@/features/countries/match"
import {
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/lib/filter-options"
import { chip, ui } from "@/lib/ui"
import type { CountryRow } from "@/types/api"

export type ClientStatusFilter = StatusFilterValue

export interface ClientFilterValues {
  status: ClientStatusFilter
  countryCode: string // "" means all
  minTotal: string // digits-only string; "" or "0" means no min
}

interface ClientFilterProps {
  onClose: () => void
  onApply: (filters: ClientFilterValues) => void
  initialValues?: ClientFilterValues
  // Hidden for a role that sees no total
  showTotal?: boolean
}

const DEFAULTS: ClientFilterValues = { status: "all", countryCode: "", minTotal: "" }

export default function ClientFilter({
  onClose,
  onApply,
  initialValues,
  showTotal = true,
}: ClientFilterProps) {
  const [status, setStatus] = useState<ClientStatusFilter>(initialValues?.status ?? "all")
  const [countryCode, setCountryCode] = useState<string>(initialValues?.countryCode ?? "")
  const [minTotal, setMinTotal] = useState<string>(initialValues?.minTotal ?? "")
  const [countryQuery, setCountryQuery] = useState("")

  const { data: countries } = useCountries()

  const allCountries = countries ?? []

  const dirty =
    status !== DEFAULTS.status ||
    countryCode !== DEFAULTS.countryCode ||
    (minTotal !== "" && minTotal !== "0")

  const handleReset = () => {
    setStatus("all")
    setCountryCode("")
    setMinTotal("")
    setCountryQuery("")
  }

  const handleApply = () => {
    onApply({ status, countryCode, minTotal })
    onClose()
  }

  const formatRupiah = (digits: string) => {
    if (!digits) return ""
    const n = Number(digits)
    if (!Number.isFinite(n)) return ""
    return n.toLocaleString("id-ID")
  }

  return (
    <Modal
      title="Filter Klien"
      onClose={onClose}
      footer={
        <FilterFooter
          onReset={handleReset}
          canReset={dirty}
          onCancel={onClose}
          onApply={handleApply}
        />
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Status Klien</div>
        <div className={ui.field}>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setStatus(o.value)}
                aria-pressed={status === o.value}
                className={chip(status === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Negara Asal</div>
        <div className={ui.field}>
          <SearchCombobox<CountryRow>
            items={matchCountries(allCountries, countryQuery)}
            value={allCountries.find((c) => c.code === countryCode) ?? null}
            onValueChange={(c) => setCountryCode(c?.code ?? "")}
            query={countryQuery}
            onQueryChange={setCountryQuery}
            itemKey={(c) => c.code}
            itemToString={(c) => c.name}
            placeholder="Ketik nama negara..."
            aria-label="Negara asal"
            clearLabel="Bersihkan negara"
            inputClassName={`h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-9 py-2.5 text-sm text-[#191C1E] outline-none transition ${ui.fieldFocus}`}
            panelClassName="max-h-[200px] border-[rgba(204,195,216,0.4)] py-1"
            empty={<div className={messageCls}>Tidak ada hasil</div>}
            leading={
              <svg
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94A3B8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            }
          />
        </div>
      </div>

      {showTotal && (
        <div className={ui.modalSection}>
          <div className={ui.modalSectionHeading}>Min Total Pembelian</div>
          <div className={ui.field}>
            <div className={ui.prefixWrap}>
              <span className={ui.prefixLabel}>IDR</span>
              <input
                className={ui.prefixInput}
                type="text"
                inputMode="numeric"
                placeholder="0"
                aria-label="Min total pembelian"
                value={formatRupiah(minTotal)}
                onChange={(e) => setMinTotal(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
