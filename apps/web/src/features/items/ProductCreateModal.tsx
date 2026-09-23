import { useId, useMemo, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import Modal from "@/components/shared/Modal"
import { useCreateItem } from "@/features/items/hooks"
import { useUnits } from "@/features/units/hooks"
import { errorMessage } from "@/lib/errors"
import { dropdownLabel, ui } from "@/lib/ui"

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
}

export default function ProductCreateModal({
  open,
  onOpenChange,
  onSuccess,
}: ProductCreateModalProps) {
  const [nama, setNama] = useState("")
  const [kode, setKode] = useState("")
  const [satuan, setSatuan] = useState("")
  const [satuanQuery, setSatuanQuery] = useState("")
  const [showSatuanSuggestions, setShowSatuanSuggestions] = useState(false)
  const [aktif, setAktif] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: units } = useUnits()
  const filteredUnits = useMemo(() => {
    const q = satuanQuery.trim().toLowerCase()
    if (!q) return []
    return (units ?? [])
      .filter((u) => u.code.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q))
      .slice(0, 5)
  }, [units, satuanQuery])
  const createItem = useCreateItem()
  const nameId = useId()
  const impaId = useId()
  const unitId = useId()
  const statusId = useId()

  if (!open) return null

  const isValid = nama.trim().length > 0

  async function handleSubmit() {
    if (!isValid) return
    setSubmitError(null)
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
      setSubmitError(errorMessage(err, "Gagal menyimpan produk."))
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
    setShowSatuanSuggestions(false)
    setAktif(true)
    setSubmitError(null)
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
            <button
              type="button"
              className={ui.modalCancel}
              onClick={handleCancel}
              disabled={createItem.isPending}
            >
              Batal
            </button>
            <button
              type="button"
              className={ui.modalSubmit}
              onClick={handleSubmit}
              disabled={!isValid || createItem.isPending}
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
            className={`${ui.fieldInput} font-sans`}
            type="text"
            placeholder="Masukkan nama produk..."
            value={nama}
            onChange={(e) => setNama(e.target.value)}
          />
        </div>

        <div className={ui.field}>
          <label htmlFor={impaId} className={ui.fieldLabel}>
            Kode IMPA
          </label>
          <input
            id={impaId}
            className={`${ui.fieldInput} font-sans`}
            type="text"
            inputMode="numeric"
            placeholder="Contoh: 330212"
            value={kode}
            onChange={(e) => setKode(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <div className={ui.field}>
          <label htmlFor={unitId} className={ui.fieldLabel}>
            Satuan Default
          </label>
          <div className="relative">
            <input
              id={unitId}
              autoComplete="off"
              className={`${ui.fieldInput} font-sans ${satuanQuery ? "pr-9" : ""}`}
              type="text"
              placeholder="Ketik nama satuan..."
              value={satuanQuery}
              onChange={(e) => {
                setSatuanQuery(e.target.value)
                setShowSatuanSuggestions(true)
                if (satuan) setSatuan("")
              }}
              onFocus={() => {
                if (satuanQuery.length > 0 && !satuan) setShowSatuanSuggestions(true)
              }}
            />
            {satuanQuery && (
              <button
                type="button"
                onClick={() => {
                  setSatuanQuery("")
                  setSatuan("")
                  setShowSatuanSuggestions(false)
                }}
                title="Bersihkan"
                aria-label="Bersihkan satuan"
                className={`absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center rounded-sm p-1 text-[#94A3B8] ${ui.focusRing}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="1" y1="1" x2="13" y2="13" />
                  <line x1="13" y1="1" x2="1" y2="13" />
                </svg>
              </button>
            )}
            {showSatuanSuggestions && satuanQuery.length > 0 && (
              <div className={ui.dropdownPanel}>
                {filteredUnits.length === 0 ? (
                  <div className="px-5 py-3 text-center text-[13px] text-[#94A3B8]">
                    Tidak ada hasil
                  </div>
                ) : (
                  filteredUnits.map((u) => {
                    const active = satuan === u.code
                    const label = u.name ? `${u.code} — ${u.name}` : u.code
                    return (
                      <button
                        key={u.id}
                        type="button"
                        className={ui.dropdownItem}
                        onClick={() => {
                          setSatuan(u.code)
                          setSatuanQuery(u.code)
                          setShowSatuanSuggestions(false)
                        }}
                      >
                        <span className={dropdownLabel(active)}>{label}</span>
                        {active && <CheckIcon />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>
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
