import { Link } from "@tanstack/react-router"
import { useEffect, useId, useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import * as clientsApi from "@/features/clients/api"
import {
  contactEmailError,
  contactUpdateBody,
  getCompanyInitials,
} from "@/features/clients/helpers"
import {
  useClientContacts,
  useClientLogoDownloadUrl,
  useCreateContact,
  useDeleteContact,
  useUpdateClient,
  useUpdateContact,
  useUploadClientLogo,
} from "@/features/clients/hooks"
import CountryCombobox from "@/features/countries/CountryCombobox"
import { useCountries } from "@/features/countries/hooks"
import { useObjectUrl } from "@/hooks/useObjectUrl"
import { logoBackground } from "@/lib/avatar"
import { formErrors } from "@/lib/form-errors"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import { validateAsset } from "@/lib/upload-validation"
import {
  digitsOnly,
  optionalEmailError,
  optionalNpwpError,
  optionalPhoneError,
} from "@/lib/validation"
import type { ClientRow } from "@/types/api"
import ClientQuotations from "./ClientQuotations"

type ClientDetailProps = {
  client: ClientRow
}

const labelCls =
  "mb-2 block text-[10px] font-bold uppercase leading-[15px] tracking-[1px] text-[#4A4455]"

// Shared field shell.
//
// Height and radius vary per use, so they stay out of here.
const inputBase = `w-full border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium text-[#191C1E] outline-none transition-[border-color,box-shadow] duration-150 ${ui.fieldFocus}`

const inputCls = `${inputBase} h-11 rounded-md border-transparent`

// Shell without text color.
//
// For value-dependent coloring.
const inputBaseNoColor = `w-full border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium outline-none transition-[border-color,box-shadow] duration-150 ${ui.fieldFocus}`

// Responsive two column track sizing.
const grid2 = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]"

const contactCancelCls = `rounded-md px-4 py-2 text-[13px] font-semibold text-primary-700 ${ui.focusRing}`

// Brand gradient from legacy inline.
const gradientCls = "bg-[linear-gradient(135deg,#630ED4_0%,#7C3AED_100%)]"

// Contact save button classes.
function contactSaveCls(enabled: boolean): string {
  return `rounded-md px-4 py-2 text-[13px] font-semibold text-white ${ui.focusRing} ${
    enabled ? `${gradientCls} cursor-pointer` : "cursor-default bg-[#CBD5E1]"
  }`
}

// Inputs the API can refuse.
const CLIENT_FIELDS = ["name", "phone", "email", "npwp"] as const

type ClientField = (typeof CLIENT_FIELDS)[number]

// Inline field message.
function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null
  return (
    <div id={id} className="mt-1.5 text-xs text-[#DC2626]">
      {message}
    </div>
  )
}

export default function ClientDetail({ client }: ClientDetailProps) {
  const [name, setName] = useState(client.name)
  const [tkuId, setTkuId] = useState(client.tkuId ?? "")
  const [countryCode, setCountryCode] = useState(client.countryCode)
  const [phone, setPhone] = useState(client.contactPhone ?? "")
  const [email, setEmail] = useState(client.email ?? "")
  const [npwp, setNpwp] = useState(client.npwp ?? "")
  const [address, setAddress] = useState(client.address ?? "")
  const [isActive, setIsActive] = useState(client.isActive)
  // Picked logo preview
  const [logoPreview, setLogoPreview] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ClientField, string>>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const fid = useId()

  // Contact form state.
  const [contactFormOpen, setContactFormOpen] = useState(false)
  const [newContactName, setNewContactName] = useState("")
  const [newContactPhone, setNewContactPhone] = useState("")
  const [newContactEmail, setNewContactEmail] = useState("")
  const [newContactTitle, setNewContactTitle] = useState("")

  // Per-row inline edit state.
  const [editingContactId, setEditingContactId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editTitle, setEditTitle] = useState("")
  // Server refusal of a taken email, until the input changes.
  const [newEmailTaken, setNewEmailTaken] = useState("")
  const [editEmailTaken, setEditEmailTaken] = useState("")

  const { data: countries } = useCountries()
  const updateClient = useUpdateClient()
  const uploadLogo = useUploadClientLogo()
  const { data: logoDownload } = useClientLogoDownloadUrl(client.id, client.logoObjectKey)
  const storedLogo = useObjectUrl(logoDownload?.downloadUrl)
  const logoDataUrl = logoPreview || storedLogo
  const { data: contactList = [], isError: contactsError } = useClientContacts(client.id)
  const createContact = useCreateContact()
  const updateContact = useUpdateContact()
  const deleteContact = useDeleteContact()

  // Deactivate, not delete.
  function confirmRemoveContact() {
    if (pendingDeleteId === null) return
    deleteContact.mutate(
      { companyId: client.id, contactId: pendingDeleteId },
      { onSettled: () => setPendingDeleteId(null) },
    )
  }

  // Form state hydrates once from the state initializers above. The route
  // remounts on a different client, so a background refetch of the same client
  // never overwrites in-progress edits.

  // Main contact phone follows edits.
  //
  // No HP is the main contact's phone, which the contacts table also edits.
  // A changed stored phone replaces the field only while it is untouched, so
  // Simpan never writes the old number back over the table's edit.
  const storedPhone = client.contactPhone ?? ""
  const lastStoredPhone = useRef(storedPhone)
  useEffect(() => {
    const previous = lastStoredPhone.current
    if (previous === storedPhone) return
    lastStoredPhone.current = storedPhone
    setPhone((current) => (current === previous ? storedPhone : current))
  }, [storedPhone])

  const dirty =
    name !== client.name ||
    tkuId !== (client.tkuId ?? "") ||
    countryCode !== client.countryCode ||
    email !== (client.email ?? "") ||
    npwp !== (client.npwp ?? "") ||
    address !== (client.address ?? "") ||
    phone !== (client.contactPhone ?? "") ||
    isActive !== client.isActive

  // A server message wins until the input changes.
  const phoneError = fieldErrors.phone || optionalPhoneError(phone)
  const emailError = fieldErrors.email || optionalEmailError(email)
  const npwpError = fieldErrors.npwp || optionalNpwpError(npwp, countryCode)
  const newPhoneError = optionalPhoneError(newContactPhone)
  const newEmailError = newEmailTaken || optionalEmailError(newContactEmail)
  const canAddContact = Boolean(newContactName.trim()) && !newPhoneError && !newEmailError
  const editPhoneError = optionalPhoneError(editPhone)
  const editEmailError = editEmailTaken || optionalEmailError(editEmail)
  const canSaveContact = Boolean(editName.trim()) && !editPhoneError && !editEmailError

  const countryOption = countries?.find((c) => c.code === countryCode)
  const dialCode = countryOption?.dialCode ?? ""

  const handleCancel = () => {
    setName(client.name)
    setTkuId(client.tkuId ?? "")
    setCountryCode(client.countryCode)
    setPhone(client.contactPhone ?? "")
    setEmail(client.email ?? "")
    setNpwp(client.npwp ?? "")
    setAddress(client.address ?? "")
    setIsActive(client.isActive)
    setFieldErrors({})
    setSubmitError(null)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const errs: Partial<Record<ClientField, string>> = {}
    if (!name.trim()) errs.name = "Wajib diisi"
    if (phoneError) errs.phone = phoneError
    if (emailError) errs.email = emailError
    if (npwpError) errs.npwp = npwpError
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    try {
      // Phone lives on the main contact. Update it when one exists, otherwise
      // create the contact so a phone can be set on a contactless client.
      if (phone !== (client.contactPhone ?? "")) {
        if (client.contactId) {
          await clientsApi.updateContact(client.id, client.contactId, {
            name: client.contactName ?? name.trim(),
            phone: phone.trim() || undefined,
            countryCode,
          })
        } else if (phone.trim()) {
          await clientsApi.createContact(client.id, {
            name: client.contactName ?? name.trim(),
            phone: phone.trim(),
            countryCode,
          })
        }
      }
      await updateClient.mutateAsync({
        id: client.id,
        input: {
          name: name.trim(),
          npwp: npwp.trim() || undefined,
          address: address.trim() || undefined,
          email: email.trim() || undefined,
          countryCode,
          tkuId: tkuId.trim() || undefined,
          isActive,
        },
      })
      setFieldErrors({})
    } catch (err) {
      const split = formErrors(err, CLIENT_FIELDS, "Gagal menyimpan perubahan")
      setFieldErrors(split.fields)
      setSubmitError(split.banner)
    }
  }

  function closeAddContactForm() {
    setContactFormOpen(false)
    setNewContactName("")
    setNewContactPhone("")
    setNewContactEmail("")
    setNewContactTitle("")
    setNewEmailTaken("")
  }

  function openEditContact(c: {
    id: number
    name: string
    phone?: string
    email?: string
    title?: string
  }) {
    setEditingContactId(c.id)
    setEditName(c.name)
    setEditPhone(c.phone ?? "")
    setEditEmail(c.email ?? "")
    setEditTitle(c.title ?? "")
    setEditEmailTaken("")
  }

  const logoBg = logoBackground(client.name)

  // Preview, revert on failure.
  //
  // Only a valid file reaches the preview.
  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    try {
      validateAsset("clientLogo", file)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logo tidak valid.")
      return
    }
    const previous = logoPreview
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoPreview(reader.result)
    }
    reader.readAsDataURL(file)
    uploadLogo.mutate(
      { id: client.id, file },
      {
        onError: () => {
          reader.abort()
          setLogoPreview(previous)
        },
      },
    )
  }

  return (
    <div className={ui.pageContent}>
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className={ui.breadcrumb}>
          <Link to="/clients" className={`${ui.breadcrumbLink} no-underline`}>
            Daftar Klien
          </Link>
          <span aria-hidden="true" className={ui.breadcrumbSep}>
            &rsaquo;
          </span>
          <span aria-current="page" className={ui.breadcrumbCurrent}>
            Detail Klien
          </span>
        </nav>

        <div className="flex items-center gap-5">
          <Link
            to="/clients"
            aria-label="Kembali ke Daftar Klien"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)] ${ui.focusRing}`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4A4455"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>
          <h1 className={ui.pageTitle}>Detail Klien</h1>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5 max-sm:flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            aria-label="Pilih logo klien"
            onChange={(e) => {
              handleLogoSelect(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Klik untuk ganti logo"
              aria-label="Ganti logo klien"
              className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg p-0 text-[20px] font-extrabold tracking-[0.5px] text-white ${ui.focusRing}`}
              style={{ background: logoDataUrl ? "#FFFFFF" : logoBg }}
            >
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                getCompanyInitials(client.name)
              )}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Ganti logo"
              aria-hidden="true"
              tabIndex={-1}
              className="absolute -bottom-1 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white bg-white p-0 shadow-[0_2px_6px_rgba(0,0,0,0.15)]"
            >
              <span
                className={`flex h-full w-full items-center justify-center rounded-full ${gradientCls}`}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 break-words text-[18px] font-bold leading-6 tracking-[-0.4px] text-[#191C1E]">
              {client.name}
            </h2>
            <p className="m-0 text-[13px] font-medium leading-[18px] text-[#4A4455]">
              Nomor Klien{" "}
              <span className="font-bold tabular-nums text-[#191C1E]">{client.number || "-"}</span>
            </p>
          </div>
          <div
            className={`flex shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 max-sm:basis-full ${
              client.isActive ? "border-[#BBF7D0] bg-[#F0FDF4]" : "border-[#FECACA] bg-[#FEF2F2]"
            }`}
          >
            <span className="text-[9px] font-semibold uppercase leading-[11px] tracking-[1.4px] text-dark-500">
              Status
            </span>
            <span
              className={`text-[13px] font-extrabold leading-4 tracking-[0.2px] ${
                client.isActive ? "text-[#065F46]" : "text-[#991B1B]"
              }`}
            >
              {client.isActive ? "Aktif" : "Nonaktif"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-8 rounded-lg bg-white p-8">
          <div>
            <h3 className="m-0 text-[20px] font-bold leading-7 tracking-[-0.5px] text-[#191C1E]">
              Informasi Utama Klien
            </h3>
            <p className="m-0 mt-1 text-sm font-normal leading-5 text-[#4A4455]">
              Kelola informasi klien.
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor={`${fid}-name`} className={labelCls}>
                Nama Klien <span className="text-[#DC2626]">*</span>
              </label>
              <input
                id={`${fid}-name`}
                aria-invalid={Boolean(fieldErrors.name)}
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setFieldErrors((p) => ({ ...p, name: "" }))
                }}
                className={`${inputBase} h-11 rounded-md ${
                  fieldErrors.name ? "border-[#DC2626]" : "border-transparent"
                }`}
              />
              {fieldErrors.name && (
                <div className="mt-1.5 text-xs text-[#DC2626]">{fieldErrors.name}</div>
              )}
            </div>

            <div className={`${grid2} gap-6`}>
              <div>
                <label htmlFor={`${fid}-tku`} className={labelCls}>
                  Nomor TKU
                </label>
                <input
                  id={`${fid}-tku`}
                  type="text"
                  value={tkuId}
                  placeholder="Masukkan TKU"
                  onChange={(e) => setTkuId(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={`${fid}-country`} className={labelCls}>
                  Kode Negara
                </label>
                <CountryCombobox
                  code={countryCode}
                  onCodeChange={setCountryCode}
                  triggerId={`${fid}-country`}
                  triggerClassName={`${inputBase} flex h-11 items-center justify-between rounded-md border-transparent text-left`}
                  fallback={countryCode}
                  chevronColor="#94A3B8"
                  panelClassName="max-h-[260px] py-1"
                />
              </div>
            </div>

            <div className={`${grid2} gap-6`}>
              <div>
                <label htmlFor={`${fid}-phone`} className={labelCls}>
                  No HP
                </label>
                <div className="flex h-11 overflow-hidden rounded-md">
                  <span className="flex shrink-0 items-center whitespace-nowrap bg-[#E6E8EA] px-3 text-sm font-medium text-[#4A4455]">
                    {dialCode || "+62"}
                  </span>
                  <input
                    id={`${fid}-phone`}
                    type="text"
                    inputMode="numeric"
                    value={phone}
                    aria-invalid={phoneError ? true : undefined}
                    aria-describedby={phoneError ? `${fid}-phone-error` : undefined}
                    onChange={(e) => {
                      setPhone(digitsOnly(e.target.value))
                      setFieldErrors((p) => ({ ...p, phone: "" }))
                    }}
                    placeholder="-"
                    className={`${inputBaseNoColor} h-full min-w-0 flex-1 rounded-none border-transparent ${
                      phone ? "text-[#191C1E]" : "text-[#94A3B8]"
                    }`}
                    title="Nomor kontak utama klien"
                  />
                </div>
                <FieldError id={`${fid}-phone-error`} message={phoneError} />
              </div>
              <div>
                <label htmlFor={`${fid}-email`} className={labelCls}>
                  Email
                </label>
                <input
                  id={`${fid}-email`}
                  type="email"
                  value={email}
                  placeholder="contact@nusantara.com"
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? `${fid}-email-error` : undefined}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setFieldErrors((p) => ({ ...p, email: "" }))
                  }}
                  className={inputCls}
                />
                <FieldError id={`${fid}-email-error`} message={emailError} />
              </div>
            </div>

            <div>
              <label htmlFor={`${fid}-npwp`} className={labelCls}>
                NPWP
              </label>
              <input
                id={`${fid}-npwp`}
                type="text"
                value={npwp}
                placeholder="0000.0000.0000.0000"
                aria-invalid={npwpError ? true : undefined}
                aria-describedby={npwpError ? `${fid}-npwp-error` : undefined}
                onChange={(e) => {
                  setNpwp(e.target.value)
                  setFieldErrors((p) => ({ ...p, npwp: "" }))
                }}
                className={`h-[47px] w-full rounded-md border-[1.5px] border-transparent bg-[#F2F4F6] px-4 py-3 font-sans text-base font-medium text-[#191C1E] outline-none transition-[border-color,box-shadow] duration-150 ${ui.fieldFocus}`}
              />
              <FieldError id={`${fid}-npwp-error`} message={npwpError} />
            </div>

            <div>
              <label htmlFor={`${fid}-address`} className={labelCls}>
                Alamat Rinci
              </label>
              <textarea
                id={`${fid}-address`}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={3}
                placeholder="Gedung Wisma Niaga, Lantai 12, Jl. Sudirman Kav 52-53"
                className={`${inputBase} h-auto min-h-24 resize-y rounded-md border-transparent`}
              />
            </div>
          </div>

          <div className="border-t border-[#ECEEF0] pt-6">
            <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5">
              <div className="min-w-0 flex-1">
                <div id={`${fid}-status`} className="text-sm font-bold leading-5 text-[#191C1E]">
                  Status Klien
                </div>
                <div
                  id={`${fid}-status-desc`}
                  className="mt-1 text-xs font-normal leading-4 text-[#4A4455]"
                >
                  Klien nonaktif tidak dapat dipakai untuk penawaran baru. Penawaran, PO, dan
                  invoice yang sudah ada tidak berubah.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                role="switch"
                aria-checked={isActive}
                aria-labelledby={`${fid}-status`}
                aria-describedby={`${fid}-status-desc`}
                className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-[background] duration-200 ease-[ease] motion-reduce:transition-none ${ui.focusRing} ${
                  isActive ? "bg-primary-700" : "bg-[#CBD5E1]"
                }`}
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ease-[ease] motion-reduce:transition-none ${
                    isActive ? "left-7" : "left-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-md border-l-4 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#7F1D1D]"
            >
              {submitError}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 rounded-lg bg-white p-8 max-sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="m-0 text-[20px] font-bold leading-7 tracking-[-0.5px] text-[#191C1E]">
              Daftar Narahubung
            </h3>
            <p className="m-0 mt-1 text-sm font-normal leading-5 text-[#4A4455]">
              Kelola narahubung klien.
            </p>
          </div>
          {!contactFormOpen && (
            <button
              type="button"
              onClick={() => setContactFormOpen(true)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold text-white ${gradientCls} ${ui.focusRing}`}
            >
              + Tambah Narahubung
            </button>
          )}
        </div>

        {contactList.length > 0 && (
          <div className="flex flex-col gap-3">
            {contactList.map((c) =>
              editingContactId === c.id ? (
                <div key={c.id} className="flex flex-col gap-3 rounded-md bg-[#F5F0FF] p-4">
                  <div className={`${grid2} gap-3`}>
                    <div>
                      <label htmlFor={`${fid}-edit-name`} className={labelCls}>
                        Nama <span className="text-[#DC2626]">*</span>
                      </label>
                      <input
                        id={`${fid}-edit-name`}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${fid}-edit-title`} className={labelCls}>
                        Jabatan
                      </label>
                      <input
                        id={`${fid}-edit-title`}
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${fid}-edit-phone`} className={labelCls}>
                        No HP
                      </label>
                      <input
                        id={`${fid}-edit-phone`}
                        type="text"
                        inputMode="numeric"
                        value={editPhone}
                        aria-invalid={editPhoneError ? true : undefined}
                        aria-describedby={editPhoneError ? `${fid}-edit-phone-error` : undefined}
                        onChange={(e) => setEditPhone(digitsOnly(e.target.value))}
                        className={inputCls}
                      />
                      <FieldError id={`${fid}-edit-phone-error`} message={editPhoneError} />
                    </div>
                    <div>
                      <label htmlFor={`${fid}-edit-email`} className={labelCls}>
                        Email
                      </label>
                      <input
                        id={`${fid}-edit-email`}
                        type="email"
                        value={editEmail}
                        aria-invalid={editEmailError ? true : undefined}
                        aria-describedby={editEmailError ? `${fid}-edit-email-error` : undefined}
                        onChange={(e) => {
                          setEditEmail(e.target.value)
                          setEditEmailTaken("")
                        }}
                        className={inputCls}
                      />
                      <FieldError id={`${fid}-edit-email-error`} message={editEmailError} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingContactId(null)}
                      className={contactCancelCls}
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={!canSaveContact || updateContact.isPending}
                      onClick={() => {
                        if (!canSaveContact) return
                        updateContact.mutate(
                          {
                            companyId: client.id,
                            contactId: c.id,
                            input: contactUpdateBody(
                              {
                                name: editName,
                                phone: editPhone,
                                email: editEmail,
                                title: editTitle,
                              },
                              c.countryCode,
                            ),
                          },
                          {
                            onSuccess: () => setEditingContactId(null),
                            onError: (err) => setEditEmailTaken(contactEmailError(err) ?? ""),
                          },
                        )
                      }}
                      className={contactSaveCls(canSaveContact)}
                    >
                      {updateContact.isPending ? "Menyimpan..." : "Simpan"}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-[#F2F4F6] px-4 py-3"
                >
                  {/* Own row on phones, actions below */}
                  <div className="min-w-0 flex-1 max-sm:basis-full">
                    <div className="break-words text-sm font-semibold text-[#191C1E]">
                      {c.name}
                      {c.title && (
                        <span className="ml-2 text-xs font-normal text-dark-500">{c.title}</span>
                      )}
                    </div>
                    {(c.phone || c.email) && (
                      <div className="mt-0.5 break-words text-xs text-dark-500">
                        {[c.phone, c.email].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => openEditContact(c)}
                      aria-label={`Ubah narahubung ${c.name}`}
                      className={`rounded-sm border-[1.5px] border-primary-700 px-3 py-1.5 text-xs font-semibold text-primary-700 ${ui.focusRing}`}
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(c.id)}
                      aria-label={`Hapus narahubung ${c.name}`}
                      className={`rounded-sm border-[1.5px] border-[#DC2626] px-3 py-1.5 text-xs font-semibold text-[#DC2626] ${ui.focusRing}`}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {contactFormOpen && (
          <div className="flex flex-col gap-3 rounded-md bg-[#F5F0FF] p-4">
            <div className={`${grid2} gap-3`}>
              <div>
                <label htmlFor={`${fid}-new-name`} className={labelCls}>
                  Nama <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  id={`${fid}-new-name`}
                  type="text"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="Nama narahubung"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={`${fid}-new-title`} className={labelCls}>
                  Jabatan
                </label>
                <input
                  id={`${fid}-new-title`}
                  type="text"
                  value={newContactTitle}
                  onChange={(e) => setNewContactTitle(e.target.value)}
                  placeholder="Jabatan"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor={`${fid}-new-phone`} className={labelCls}>
                  No HP
                </label>
                <input
                  id={`${fid}-new-phone`}
                  type="text"
                  inputMode="numeric"
                  value={newContactPhone}
                  aria-invalid={newPhoneError ? true : undefined}
                  aria-describedby={newPhoneError ? `${fid}-new-phone-error` : undefined}
                  onChange={(e) => setNewContactPhone(digitsOnly(e.target.value))}
                  placeholder="-"
                  className={inputCls}
                />
                <FieldError id={`${fid}-new-phone-error`} message={newPhoneError} />
              </div>
              <div>
                <label htmlFor={`${fid}-new-email`} className={labelCls}>
                  Email
                </label>
                <input
                  id={`${fid}-new-email`}
                  type="email"
                  value={newContactEmail}
                  aria-invalid={newEmailError ? true : undefined}
                  aria-describedby={newEmailError ? `${fid}-new-email-error` : undefined}
                  onChange={(e) => {
                    setNewContactEmail(e.target.value)
                    setNewEmailTaken("")
                  }}
                  placeholder="email@perusahaan.com"
                  className={inputCls}
                />
                <FieldError id={`${fid}-new-email-error`} message={newEmailError} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeAddContactForm} className={contactCancelCls}>
                Batal
              </button>
              <button
                type="button"
                disabled={!canAddContact || createContact.isPending}
                onClick={() => {
                  if (!canAddContact) return
                  createContact.mutate(
                    {
                      companyId: client.id,
                      input: {
                        name: newContactName.trim(),
                        phone: newContactPhone.trim() || undefined,
                        email: newContactEmail.trim() || undefined,
                        title: newContactTitle.trim() || undefined,
                      },
                    },
                    {
                      onSuccess: closeAddContactForm,
                      onError: (err) => setNewEmailTaken(contactEmailError(err) ?? ""),
                    },
                  )
                }}
                className={contactSaveCls(canAddContact)}
              >
                {createContact.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        )}

        {contactsError && (
          <div className="p-6 text-center text-sm text-[#DC2626]">Gagal memuat narahubung.</div>
        )}

        {!contactsError && contactList.length === 0 && !contactFormOpen && (
          <div className="p-6 text-center text-sm text-[#94A3B8]">
            Belum ada narahubung. Klik Tambah Narahubung untuk menambahkan.
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-4">
        <button
          type="button"
          onClick={handleCancel}
          disabled={!dirty || updateClient.isPending}
          className={`rounded-lg bg-transparent px-7 py-3 text-sm font-bold ${ui.focusRing} ${
            dirty && !updateClient.isPending
              ? "cursor-pointer text-primary-700"
              : "cursor-default text-[#CBD5E1]"
          }`}
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!dirty || updateClient.isPending}
          className={`rounded-lg px-8 py-3 text-sm font-bold text-white ${ui.focusRing} ${
            dirty
              ? `${gradientCls} shadow-[0px_10px_15px_-3px_rgba(99,14,212,0.2),0px_4px_6px_-4px_rgba(99,14,212,0.2)]`
              : "bg-[#CBD5E1] shadow-none"
          } ${dirty && !updateClient.isPending ? "cursor-pointer" : "cursor-default"} ${
            updateClient.isPending ? "opacity-70" : "opacity-100"
          }`}
        >
          {updateClient.isPending ? "Menyimpan…" : "Simpan Perubahan"}
        </button>
      </div>

      <ClientQuotations clientId={client.id} />

      {pendingDeleteId !== null && (
        <Modal
          title="Nonaktifkan narahubung ini?"
          onClose={() => setPendingDeleteId(null)}
          className="max-w-[min(440px,92vw)]!"
          footer={
            <>
              <button
                type="button"
                className={ui.modalCancel}
                onClick={() => setPendingDeleteId(null)}
                disabled={deleteContact.isPending}
              >
                Batal
              </button>
              <button
                type="button"
                className={ui.modalSubmit}
                onClick={confirmRemoveContact}
                disabled={deleteContact.isPending}
              >
                {deleteContact.isPending ? "Memproses..." : "Nonaktifkan"}
              </button>
            </>
          }
        >
          <p className="m-0 text-sm leading-6 text-[#4A4455]">
            Narahubung tidak lagi tampil di daftar ini dan tidak dapat dipilih untuk penawaran baru.
            Dokumen yang sudah memakainya tidak berubah.
          </p>
        </Modal>
      )}
    </div>
  )
}
