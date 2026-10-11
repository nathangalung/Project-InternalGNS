import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { ITEM_FIELDS, type ItemField, impaTakenHolder } from "@/features/items/helpers"
import { useCreateItem, useRenameItem } from "@/features/items/hooks"
import ImpaTakenText from "@/features/items/ImpaTakenText"
import type { CatalogItem } from "@/features/items/ProductAdd/helpers"
import { useUnits } from "@/features/units/hooks"
import UnitCombobox from "@/features/units/UnitCombobox"
import { errorMessage } from "@/lib/errors"
import { formErrors } from "@/lib/form-errors"
import { ui } from "@/lib/ui"
import type { ItemImpaHolder } from "@/types/api"

type ProductCreateModalData = {
  id: number
  nama: string
  kode: string
  satuan: string
  aktif: boolean
}

type ProductCreateModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (data: ProductCreateModalData) => void
  // Takes the product holding a typed IMPA code instead
  onPickExisting?: (item: CatalogItem) => void
  // The role writes the catalog, so it may rename that product
  renames?: boolean
}

export default function ProductCreateModal({
  open,
  onOpenChange,
  onSuccess,
  onPickExisting,
  renames = false,
}: ProductCreateModalProps) {
  const [nama, setNama] = useState("")
  const [kode, setKode] = useState("")
  const [satuan, setSatuan] = useState("")
  const [satuanQuery, setSatuanQuery] = useState("")
  const [aktif, setAktif] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ItemField, string>>>({})
  // Product already holding the typed code
  const [holder, setHolder] = useState<ItemImpaHolder | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)

  const { data: units } = useUnits()
  const createItem = useCreateItem()
  const renameItem = useRenameItem()
  const nameId = useId()
  const nameErrorId = useId()
  const impaId = useId()
  const impaErrorId = useId()
  const unitId = useId()
  const statusId = useId()

  if (!open) return null

  const isValid = nama.trim().length > 0
  const busy = createItem.isPending || renameItem.isPending

  async function handleSubmit() {
    if (!isValid) return
    setSubmitError(null)
    setFieldErrors({})
    setHolder(null)
    setRenameError(null)
    const unit = units?.find((u) => u.code === satuan)
    try {
      const created = await createItem.mutateAsync({
        name: nama.trim(),
        impaCode: kode.trim() || undefined,
        defaultUnitId: unit?.id,
        isActive: aktif,
      })
      onSuccess?.({ id: created.id, nama: nama.trim(), kode: kode.trim(), satuan, aktif })
      reset()
      onOpenChange(false)
    } catch (err) {
      const split = formErrors(err, ITEM_FIELDS, "Gagal menyimpan produk.")
      setFieldErrors(split.fields)
      setSubmitError(split.banner)
      setHolder(impaTakenHolder(err))
    }
  }

  // Offer the existing product instead.
  function pickExisting(item: CatalogItem) {
    onPickExisting?.(item)
    reset()
    onOpenChange(false)
  }

  function pickHolder(h: ItemImpaHolder) {
    pickExisting({ id: h.id, kode: h.impaCode, nama: h.name, defaultUnitId: h.defaultUnitId })
  }

  // Give the holder the typed name.
  async function renameHolder(h: ItemImpaHolder) {
    setRenameError(null)
    try {
      const renamed = await renameItem.mutateAsync({ id: h.id, name: nama.trim() })
      pickExisting({
        id: renamed.id,
        kode: renamed.impaCode ?? h.impaCode,
        nama: renamed.name,
        defaultUnitId: renamed.defaultUnitId,
      })
    } catch (err) {
      setRenameError(errorMessage(err, "Gagal mengganti nama produk."))
    }
  }

  function handleCancel() {
    reset()
    onOpenChange(false)
  }

  function reset() {
    setNama("")
    setKode("")
    setSatuan("")
    setSatuanQuery("")
    setAktif(true)
    setSubmitError(null)
    setFieldErrors({})
    setHolder(null)
    setRenameError(null)
  }

  return (
    <Modal
      title="Tambah Produk Baru"
      onClose={handleCancel}
      footer={
        <>
          {submitError && (
            <span role="alert" className="flex-1 text-[12px] text-error">
              {submitError}
            </span>
          )}
          <div className="flex gap-4 max-sm:w-full max-sm:*:flex-1 max-sm:*:px-4">
            <button type="button" className={ui.modalCancel} onClick={handleCancel} disabled={busy}>
              Batal
            </button>
            <button
              type="button"
              className={ui.modalSubmit}
              onClick={handleSubmit}
              disabled={!isValid || busy}
            >
              {createItem.isPending ? "Menyimpan..." : "Tambahkan"}
            </button>
          </div>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.field}>
          <label htmlFor={nameId} className={ui.fieldLabel}>
            Nama Produk <span className="text-primary-700">*</span>
          </label>
          <input
            id={nameId}
            className={`${ui.fieldInput} font-sans ${fieldErrors.name ? "border-error" : ""}`}
            type="text"
            placeholder="Masukkan nama produk..."
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? nameErrorId : undefined}
            value={nama}
            onChange={(e) => {
              setNama(e.target.value)
              setFieldErrors((p) => ({ ...p, name: undefined }))
            }}
          />
          {fieldErrors.name && (
            <p id={nameErrorId} className="text-[12px] text-error">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div className={ui.field}>
          <label htmlFor={impaId} className={ui.fieldLabel}>
            Kode IMPA
          </label>
          <input
            id={impaId}
            className={`${ui.fieldInput} font-sans ${fieldErrors.impaCode ? "border-error" : ""}`}
            type="text"
            inputMode="numeric"
            placeholder="Contoh: 330212"
            aria-invalid={fieldErrors.impaCode ? true : undefined}
            aria-describedby={fieldErrors.impaCode ? impaErrorId : undefined}
            value={kode}
            onChange={(e) => {
              setKode(e.target.value.replace(/\D/g, ""))
              setFieldErrors((p) => ({ ...p, impaCode: undefined }))
              setHolder(null)
              setRenameError(null)
            }}
          />
          {holder ? (
            <div id={impaErrorId} className="flex flex-col gap-2 text-[12px]">
              <p className="m-0 text-error">
                <ImpaTakenText holder={holder} linked={!onPickExisting} />
              </p>
              {onPickExisting && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={ui.btnOutline}
                    onClick={() => pickHolder(holder)}
                    disabled={busy}
                  >
                    Pakai Produk Ini
                  </button>
                  {renames && (
                    <button
                      type="button"
                      className={`${ui.btnOutline} max-w-full`}
                      onClick={() => void renameHolder(holder)}
                      disabled={busy || !isValid}
                    >
                      <span className="truncate">Ganti Nama Jadi “{nama.trim()}”</span>
                    </button>
                  )}
                </div>
              )}
              {renameError && (
                <p role="alert" className="m-0 text-error">
                  {renameError}
                </p>
              )}
            </div>
          ) : (
            fieldErrors.impaCode && (
              <p id={impaErrorId} className="text-[12px] text-error">
                {fieldErrors.impaCode}
              </p>
            )
          )}
        </div>

        <div className={ui.field}>
          <label htmlFor={unitId} className={ui.fieldLabel}>
            Satuan Default
          </label>
          <UnitCombobox
            code={satuan}
            onCodeChange={setSatuan}
            query={satuanQuery}
            onQueryChange={setSatuanQuery}
            inputId={unitId}
            placeholder="Ketik nama satuan..."
            inputClassName={`${ui.fieldInput} font-sans ${satuanQuery ? "pr-9" : ""}`}
          />
        </div>

        <div className="flex flex-row items-center justify-between gap-2">
          <span id={statusId} className={ui.fieldLabel}>
            Status Produk
          </span>
          <div className="flex items-center gap-2.5">
            <span
              className={`text-[12px] font-bold uppercase tracking-[0.04em] ${
                aktif ? "text-primary-700" : "text-[#9CA3AF]"
              }`}
            >
              {aktif ? "AKTIF" : "NONAKTIF"}
            </span>
            <button
              type="button"
              onClick={() => setAktif((a) => !a)}
              role="switch"
              aria-checked={aktif}
              aria-labelledby={statusId}
              className={`relative h-[22px] w-10 flex-shrink-0 rounded-[11px] transition-colors duration-200 motion-reduce:transition-none ${ui.focusRing} ${
                aktif ? "bg-primary-700" : "bg-[#D1D5DB]"
              }`}
            >
              <span
                className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left] duration-200 motion-reduce:transition-none ${
                  aktif ? "left-[21px]" : "left-[3px]"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
