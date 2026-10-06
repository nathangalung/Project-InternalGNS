import { Menu } from "@base-ui/react/menu"
import { useId } from "react"
import LoadError from "@/components/shared/LoadError"
import StoreLink from "@/components/shared/StoreLink"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/ui/autocomplete"
import type { LookupFailure } from "@/lib/lookup"
import { dropdown, dropdownLabel, ui } from "@/lib/ui"
import { cn } from "@/lib/utils"
import {
  AddNewButton,
  CheckmarkIcon,
  type DropdownKey,
  formatRp,
  type HistorisOption,
  type ProductAddFormData,
  type VendorOption,
} from "./helpers"

type VendorPriceCardProps = {
  form: ProductAddFormData
  onChange: (field: keyof ProductAddFormData, value: string) => void
  onPickVendor: (vendor: VendorOption) => void
  onPickHistoris: (harga: number) => void
  vendorMatches: VendorOption[]
  exactVendor?: VendorOption
  vendorOpen: boolean
  historisOptions: HistorisOption[]
  setOpenDropdown: (key: DropdownKey | null) => void
  closeIfMatch: (key: DropdownKey) => void
  isJumlahFilled: boolean
  isVendorFilled: boolean
  profit: number
  profitPct: string
  onAddVendorNew: () => void
  // Failed lookups
  vendorFailure?: LookupFailure | null
  historyFailure?: LookupFailure | null
  recommendationFailure?: LookupFailure | null
  // False for a role that sets no harga jual
  pricing?: boolean
}

// Vendor and price card.
export default function VendorPriceCard({
  form,
  onChange,
  onPickVendor,
  onPickHistoris,
  vendorMatches,
  exactVendor,
  vendorOpen,
  historisOptions,
  setOpenDropdown,
  closeIfMatch,
  isJumlahFilled,
  isVendorFilled,
  profit,
  profitPct,
  onAddVendorNew,
  vendorFailure = null,
  historyFailure = null,
  recommendationFailure = null,
  pricing = true,
}: VendorPriceCardProps) {
  const vendorId = useId()
  const buyId = useId()
  const sellId = useId()
  return (
    <div
      className={`${ui.modalSection} transition-opacity duration-200 ease-[ease] ${
        !isJumlahFilled ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className={ui.modalSectionHeading}>Vendor dan Harga Beli</div>
      {recommendationFailure && (
        <LoadError
          message="Gagal memuat rekomendasi vendor dan harga."
          {...recommendationFailure}
        />
      )}

      <div className={ui.field}>
        <label htmlFor={vendorId} className={ui.fieldLabel}>
          Nama Vendor <span className="text-primary-700">*</span>
        </label>
        <Autocomplete
          value={form.namaVendor}
          onValueChange={(v, d) => {
            if (d.reason === "input-change") onChange("namaVendor", v)
          }}
          open={vendorOpen && isJumlahFilled}
          onOpenChange={(open) => (open ? setOpenDropdown("vendor") : closeIfMatch("vendor"))}
          disabled={!isJumlahFilled}
        >
          <AutocompleteInput
            id={vendorId}
            className={`font-sans ${ui.disabledField}`}
            placeholder="Ketik atau pilih vendor"
            onFocus={() => {
              if (isJumlahFilled) setOpenDropdown("vendor")
            }}
          />
          <AutocompleteContent>
            {vendorFailure && (
              <LoadError
                message="Gagal memuat vendor."
                className="px-5 py-2.5"
                {...vendorFailure}
              />
            )}
            {vendorMatches.length === 0 ? (
              !vendorFailure && (
                <div className={`px-5 py-2.5 ${dropdownLabel(false)}`}>
                  Vendor tidak ditemukan. Tambahkan vendor baru.
                </div>
              )
            ) : (
              <AutocompleteList>
                {vendorMatches.map((v) => {
                  const isActive = exactVendor?.nama === v.nama
                  return (
                    <AutocompleteItem key={v.nama} value={v.nama} onClick={() => onPickVendor(v)}>
                      <span className={dropdownLabel(isActive)}>{v.nama}</span>
                      {v.harga > 0 ? (
                        <span className={priceCls(isActive)}>Rp {formatRp(v.harga)}</span>
                      ) : isActive ? (
                        <CheckmarkIcon />
                      ) : null}
                    </AutocompleteItem>
                  )
                })}
              </AutocompleteList>
            )}
            <AddNewButton label="Tambah Vendor Baru" onClick={onAddVendorNew} />
          </AutocompleteContent>
        </Autocomplete>
        {exactVendor?.storeUrl && (
          <span className="flex items-center gap-1.5 text-xs text-dark-600">
            Link toko <StoreLink url={exactVendor.storeUrl} />
          </span>
        )}
      </div>

      <div className={ui.row2}>
        <div className={ui.field}>
          <label htmlFor={buyId} className={ui.fieldLabel}>
            Harga Beli Satuan <span className="text-primary-700">*</span>
          </label>
          <input
            id={buyId}
            className={`${ui.fieldInput} font-sans ${ui.disabledField}`}
            type="number"
            min={0}
            placeholder="Masukkan harga beli"
            value={form.hargaBeli}
            onChange={(e) => onChange("hargaBeli", e.target.value)}
            disabled={!isVendorFilled}
          />
        </div>
        {pricing && (
          <div className={ui.field}>
            <label htmlFor={sellId} className={ui.fieldLabel}>
              Harga Jual Satuan <span className="text-primary-700">*</span>
            </label>
            <input
              id={sellId}
              className={`${ui.fieldInput} font-sans ${ui.disabledField}`}
              type="number"
              min={0}
              placeholder="Masukkan harga jual"
              value={form.hargaJual}
              onChange={(e) => onChange("hargaJual", e.target.value)}
              disabled={!isVendorFilled}
            />
          </div>
        )}
      </div>

      {pricing && (
        <>
          <Menu.Root modal={false}>
            <Menu.Trigger
              disabled={!isVendorFilled}
              className={`relative flex w-full items-center justify-center rounded-md border px-6 py-[11px] text-sm font-bold ${ui.focusRing} ${
                isVendorFilled
                  ? "cursor-pointer border-[rgba(99,14,212,0.2)] bg-transparent text-primary-700"
                  : "cursor-not-allowed border-[rgba(99,14,212,0.1)] bg-[#F7F7F8] text-[#A386D6]"
              }`}
            >
              <span>Riwayat Harga Jual</span>
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="absolute right-5"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                align="start"
                sideOffset={4}
                collisionAvoidance={{ side: "none" }}
                className="z-[110]"
              >
                <Menu.Popup
                  className={cn(
                    dropdown({ placement: "floating" }).panel(),
                    "max-h-(--available-height) w-(--anchor-width) overflow-y-auto outline-none",
                  )}
                >
                  {historisOptions.length === 0 && (
                    <div className={`px-5 py-2.5 ${dropdownLabel(false)}`}>
                      Belum ada riwayat harga.
                    </div>
                  )}
                  {historisOptions.map((h, i) => {
                    const isActive = form.hargaJual === String(h.harga)
                    return (
                      <Menu.Item
                        key={i}
                        className={cn(
                          dropdown().item(),
                          "outline-none data-highlighted:bg-dark-100",
                        )}
                        onClick={() => onPickHistoris(h.harga)}
                      >
                        <span className={dropdownLabel(isActive)}>{h.keterangan}</span>
                        <span className={priceCls(isActive)}>Rp {formatRp(h.harga)}</span>
                      </Menu.Item>
                    )
                  })}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          {historyFailure && (
            <LoadError message="Gagal memuat riwayat harga jual." {...historyFailure} />
          )}
        </>
      )}

      {pricing && (
        <div className={ui.field}>
          <span className={ui.fieldLabel}>Profit</span>
          <div
            className={`${ui.fieldInput} flex cursor-default items-center ${
              profit === 0 ? "text-dark-500" : "text-dark-900"
            } ${!isVendorFilled ? "bg-[#F7F7F8]" : ""}`}
          >
            {profit === 0 ? "Otomatis terisi" : `Rp ${formatRp(profit)} (${profitPct}%)`}
          </div>
        </div>
      )}
    </div>
  )
}

// Price beside a row label.
function priceCls(active: boolean): string {
  return `text-caption leading-6 ${active ? "font-bold text-primary-700" : "font-normal text-[#4A4455]"}`
}
