import { useState } from "react"
import Modal from "@/components/shared/Modal"
import { useCreateClient, useCreateContact } from "@/features/clients/hooks"
import { ui } from "@/lib/ui"
import CompanyCard from "./CompanyCard"
import ContactCard from "./ContactCard"
import {
  type ClientAddFormData,
  INITIAL_FORM,
  isValidAddress,
  isValidEmail,
  isValidPhone,
} from "./helpers"
import LegalCard from "./LegalCard"

export type { ClientAddFormData } from "./helpers"

interface ClientAddProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (data: ClientAddFormData) => void
}

// Client creation modal.
export default function ClientAdd({ open, onOpenChange, onSuccess }: ClientAddProps) {
  const [form, setForm] = useState<ClientAddFormData>(INITIAL_FORM)
  const [negaraOpen, setNegaraOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const createClient = useCreateClient()
  const createContact = useCreateContact()
  const isSaving = createClient.isPending || createContact.isPending

  if (!open) return null

  const isNamaPerusahaanFilled = form.namaPerusahaan.trim().length > 0
  const isAlamatFilled = isNamaPerusahaanFilled && isValidAddress(form.alamat)
  const alamatError =
    isNamaPerusahaanFilled && form.alamat.trim().length > 0 && !isValidAddress(form.alamat)
      ? "Alamat harus minimal 20 karakter dan mengandung huruf."
      : null

  const isNamaKontakFilled = isAlamatFilled && form.namaKontak.trim().length > 0

  const phoneFilledAndValid = form.nomorTelepon.trim().length > 0 && isValidPhone(form.nomorTelepon)
  const emailFilledAndValid = form.email.trim().length > 0 && isValidEmail(form.email)
  const phoneError =
    isNamaKontakFilled && form.nomorTelepon.trim().length > 0 && !isValidPhone(form.nomorTelepon)
      ? "Nomor telepon harus 9–13 digit angka."
      : null
  const emailError =
    isNamaKontakFilled && form.email.trim().length > 0 && !isValidEmail(form.email)
      ? "Format email tidak valid."
      : null

  const isContactValid = isNamaKontakFilled && (phoneFilledAndValid || emailFilledAndValid)

  function handleChange(field: keyof ClientAddFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    setSubmitError(null)
    try {
      const created = await createClient.mutateAsync({
        name: form.namaPerusahaan.trim(),
        countryCode: form.kodeNegara || "IDN",
        address: form.alamat.trim() || undefined,
        email: form.email.trim() || undefined,
        npwp: form.npwp.trim() || undefined,
        tkuId: form.tku.trim() || undefined,
        number: form.referenceNumber.trim() || undefined,
      })
      await createContact.mutateAsync({
        companyId: created.id,
        input: {
          name: form.namaKontak.trim(),
          phone: form.nomorTelepon.trim() || undefined,
          email: form.email.trim() || undefined,
          countryCode: form.kodeNegara || "IDN",
        },
      })
      onSuccess?.(form)
      setForm(INITIAL_FORM)
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan klien."
      setSubmitError(msg)
    }
  }

  function handleCancel() {
    setForm(INITIAL_FORM)
    onOpenChange(false)
  }

  return (
    <Modal
      title="Tambah Klien"
      onClose={handleCancel}
      footer={
        <>
          {submitError && <span className="flex-1 text-xs text-[#EF4444]">{submitError}</span>}
          {!submitError && isNamaKontakFilled && !isContactValid && (
            <span className="flex-1 text-xs text-[#EF4444]">
              Isi minimal nomor telepon atau email.
            </span>
          )}
          <button
            type="button"
            className={ui.modalCancel}
            onClick={handleCancel}
            disabled={isSaving}
          >
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={handleSubmit}
            disabled={!isContactValid || isSaving}
          >
            {isSaving ? "Menyimpan..." : "Simpan Data"}
          </button>
        </>
      }
    >
      <CompanyCard
        form={form}
        onChange={handleChange}
        isNamaPerusahaanFilled={isNamaPerusahaanFilled}
        alamatError={alamatError}
        negaraOpen={negaraOpen}
        setNegaraOpen={(fn) => setNegaraOpen(fn)}
        closeNegara={() => setNegaraOpen(false)}
      />
      <ContactCard
        form={form}
        onChange={handleChange}
        isAlamatFilled={isAlamatFilled}
        isNamaKontakFilled={isNamaKontakFilled}
        phoneError={phoneError}
        emailError={emailError}
      />
      <LegalCard form={form} onChange={handleChange} isNamaKontakFilled={isNamaKontakFilled} />
    </Modal>
  )
}
