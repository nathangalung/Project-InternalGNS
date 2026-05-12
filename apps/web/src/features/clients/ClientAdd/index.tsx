import { useState } from "react"
import { useCreateClient, useCreateContact } from "@/features/clients/hooks"
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
    <div className="ca-overlay" onClick={handleCancel}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Tambah Klien</h2>
          <button className="ca-close-btn" onClick={handleCancel} title="Tutup">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        <div className="ca-body">
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
        </div>

        <div className="ca-footer" style={{ padding: "16px 24px" }}>
          {submitError && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>{submitError}</span>
          )}
          {!submitError && isNamaKontakFilled && !isContactValid && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>
              Isi minimal nomor telepon atau email.
            </span>
          )}
          <button
            type="button"
            className="ca-btn-cancel"
            onClick={handleCancel}
            disabled={isSaving}
            style={{ padding: "8px 18px", fontSize: "13px" }}
          >
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!isContactValid || isSaving}
            style={{
              padding: "8px 22px",
              fontSize: "13px",
              opacity: !isContactValid || isSaving ? 0.5 : 1,
              cursor: !isContactValid || isSaving ? "not-allowed" : "pointer",
            }}
          >
            {isSaving ? "Menyimpan..." : "Simpan Data"}
          </button>
        </div>
      </div>
    </div>
  )
}
