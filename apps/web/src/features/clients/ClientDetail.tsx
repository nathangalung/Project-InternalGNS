import { useEffect, useRef, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import { dropdownItemStyle, dropdownLabelStyle } from "@/components/shared/filter-styles"
import Sidebar from "@/components/shared/Sidebar"
import * as clientsApi from "@/features/clients/api"
import { getCompanyInitials } from "@/features/clients/helpers"
import {
  useClientContacts,
  useClientLogoDownloadUrl,
  useCreateContact,
  useDeleteContact,
  useUpdateClient,
  useUpdateContact,
  useUploadClientLogo,
} from "@/features/clients/hooks"
import { useCountries } from "@/features/countries/hooks"
import { ApiError, fetchObjectUrl } from "@/lib/api-client"
import { logoBackground } from "@/lib/avatar"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import type { ClientRow } from "@/types/api"

interface ClientDetailProps {
  client: ClientRow
  onNavigate: (page: Page) => void
  onBack: () => void
  onLogout: () => void
}

const labelCls =
  "mb-2 block text-[10px] font-bold uppercase leading-[15px] tracking-[1px] text-[#4A4455]"

// Shared field shell; height and radius vary per use, so they stay out of here.
const inputBase =
  "w-full border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150"

const inputCls = `${inputBase} h-11 rounded-md border-transparent`

// Same shell without a text color, for value-dependent coloring.
const inputBaseNoColor =
  "w-full border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium outline-none transition-[border-color] duration-150"

// Responsive two column track sizing.
const grid2 = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]"

const dropdownPanelCls =
  "absolute left-0 right-0 top-[calc(100%+4px)] z-50 flex max-h-[260px] flex-col overflow-y-auto rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-1 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"

const contactCancelCls = "px-4 py-2 text-[13px] font-semibold text-primary-700"

// Brand gradient, faithful to legacy inline.
const gradientCls = "bg-[linear-gradient(135deg,#630ED4_0%,#7C3AED_100%)]"

// Contact form save button, enabled or not.
function contactSaveCls(enabled: boolean): string {
  return `rounded-md px-4 py-2 text-[13px] font-semibold text-white ${
    enabled ? `${gradientCls} cursor-pointer` : "cursor-default bg-[#CBD5E1]"
  }`
}

export default function ClientDetail({ client, onNavigate, onBack, onLogout }: ClientDetailProps) {
  const [name, setName] = useState(client.name)
  const [tkuId, setTkuId] = useState(client.tkuId ?? "")
  const [countryCode, setCountryCode] = useState(client.countryCode)
  const [phone, setPhone] = useState(client.contactPhone ?? "")
  const [email, setEmail] = useState(client.email ?? "")
  const [npwp, setNpwp] = useState(client.npwp ?? "")
  const [address, setAddress] = useState(client.address ?? "")
  const [isActive, setIsActive] = useState(client.isActive)
  const [logoDataUrl, setLogoDataUrl] = useState<string>("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [countryOpen, setCountryOpen] = useState(false)
  const [countryQuery, setCountryQuery] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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

  const { data: countries } = useCountries()
  const updateClient = useUpdateClient()
  const uploadLogo = useUploadClientLogo()
  const { data: logoDownload } = useClientLogoDownloadUrl(client.id, client.logoObjectKey)
  const { data: contactList = [] } = useClientContacts(client.id)
  const createContact = useCreateContact()
  const updateContact = useUpdateContact()
  const deleteContact = useDeleteContact()

  const handleRemoveContact = (contactId: number) => {
    if (!window.confirm("Hapus narahubung ini?")) return
    deleteContact.mutate({ companyId: client.id, contactId })
  }

  useEffect(() => {
    const path = logoDownload?.downloadUrl
    if (!path) {
      if (!client.logoObjectKey) setLogoDataUrl("")
      return
    }
    let active = true
    let objectUrl = ""
    fetchObjectUrl(path)
      .then((u) => {
        if (active) {
          objectUrl = u
          setLogoDataUrl(u)
        } else {
          URL.revokeObjectURL(u)
        }
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [logoDownload?.downloadUrl, client.logoObjectKey])

  useEffect(() => {
    setName(client.name)
    setTkuId(client.tkuId ?? "")
    setCountryCode(client.countryCode)
    setPhone(client.contactPhone ?? "")
    setEmail(client.email ?? "")
    setNpwp(client.npwp ?? "")
    setAddress(client.address ?? "")
    setIsActive(client.isActive)
  }, [
    client.name,
    client.tkuId,
    client.countryCode,
    client.contactPhone,
    client.email,
    client.npwp,
    client.address,
    client.isActive,
  ])

  const dirty =
    name !== client.name ||
    tkuId !== (client.tkuId ?? "") ||
    countryCode !== client.countryCode ||
    email !== (client.email ?? "") ||
    npwp !== (client.npwp ?? "") ||
    address !== (client.address ?? "") ||
    phone !== (client.contactPhone ?? "") ||
    isActive !== client.isActive

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
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = "Wajib diisi"
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
      if (err instanceof ApiError) {
        setSubmitError(err.message || "Gagal menyimpan perubahan")
      } else {
        setSubmitError("Gagal menyimpan perubahan")
      }
    }
  }

  function closeAddContactForm() {
    setContactFormOpen(false)
    setNewContactName("")
    setNewContactPhone("")
    setNewContactEmail("")
    setNewContactTitle("")
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
  }

  const logoBg = logoBackground(client.name)

  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
    uploadLogo.mutate({ id: client.id, file })
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"clients" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="flex flex-col gap-3">
            <nav className={ui.breadcrumb}>
              <button type="button" className={ui.breadcrumbLink} onClick={onBack}>
                Daftar Klien
              </button>
              <span className={ui.breadcrumbSep}>&rsaquo;</span>
              <span className={ui.breadcrumbCurrent}>Detail Klien</span>
            </nav>

            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={onBack}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
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
                >
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              <h1 className="page-title m-0">Detail Klien</h1>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
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
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg p-0 text-[20px] font-extrabold tracking-[0.5px] text-white"
                  style={{ background: logoDataUrl ? "#FFFFFF" : logoBg }}
                >
                  {logoDataUrl ? (
                    <img
                      src={logoDataUrl}
                      alt="Logo klien"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getCompanyInitials(client.name)
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Ganti logo"
                  aria-label="Ganti logo"
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
                <span className="text-[13px] font-medium leading-[18px] text-[#4A4455]">Klien</span>
              </div>
              <div
                className={`flex shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 ${
                  client.isActive
                    ? "border-[#BBF7D0] bg-[#F0FDF4]"
                    : "border-[#FECACA] bg-[#FEF2F2]"
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
                  <label className={labelCls}>
                    Nama Klien <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
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
                    <label className={labelCls}>Nomor TKU</label>
                    <input
                      type="text"
                      value={tkuId}
                      placeholder="Masukkan TKU"
                      onChange={(e) => setTkuId(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Kode Negara</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setCountryOpen((o) => !o)}
                        className={`${inputBase} flex h-11 items-center justify-between rounded-md border-transparent text-left`}
                      >
                        <span>
                          {countryOption
                            ? `${countryOption.code} - ${countryOption.name}`
                            : countryCode}
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#94A3B8"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {countryOpen && (
                        <div className={dropdownPanelCls}>
                          <div className="px-3 pb-2">
                            <input
                              type="text"
                              placeholder="Cari negara..."
                              value={countryQuery}
                              onChange={(e) => setCountryQuery(e.target.value)}
                              className="w-full rounded-sm border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3 py-2 font-sans text-[13px] text-[#191C1E] outline-none"
                            />
                          </div>
                          {(() => {
                            const q = countryQuery.trim().toLowerCase()
                            const filtered = (countries ?? [])
                              .filter(
                                (c) =>
                                  !q ||
                                  c.name.toLowerCase().includes(q) ||
                                  c.code.toLowerCase().includes(q),
                              )
                              .slice(0, 5)
                            if (filtered.length === 0) {
                              return (
                                <div className="px-5 py-3 text-center text-[13px] text-[#94A3B8]">
                                  Tidak ada hasil
                                </div>
                              )
                            }
                            return filtered.map((c) => {
                              const active = countryCode === c.code
                              return (
                                <button
                                  key={c.code}
                                  type="button"
                                  style={dropdownItemStyle}
                                  onClick={() => {
                                    setCountryCode(c.code)
                                    setCountryQuery("")
                                    setCountryOpen(false)
                                  }}
                                >
                                  <span style={dropdownLabelStyle(active)}>
                                    {c.code} - {c.name}
                                  </span>
                                  {active && <CheckIcon />}
                                </button>
                              )
                            })
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`${grid2} gap-6`}>
                  <div>
                    <label className={labelCls}>No HP</label>
                    <div className="flex h-11 overflow-hidden rounded-md">
                      <span className="flex shrink-0 items-center whitespace-nowrap bg-[#E6E8EA] px-3 text-sm font-medium text-[#4A4455]">
                        {dialCode || "+62"}
                      </span>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                        placeholder="-"
                        className={`${inputBaseNoColor} h-full min-w-0 flex-1 rounded-none border-transparent ${
                          phone ? "text-[#191C1E]" : "text-[#94A3B8]"
                        }`}
                        title="Nomor kontak utama klien"
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      value={email}
                      placeholder="contact@nusantara.com"
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>NPWP</label>
                  <input
                    type="text"
                    value={npwp}
                    placeholder="00.000.000.0-000.000"
                    onChange={(e) => setNpwp(e.target.value)}
                    className="h-[47px] w-full rounded-md border-[1.5px] border-transparent bg-[#F2F4F6] px-4 py-3 font-sans text-base font-medium text-[#191C1E] outline-none transition-[border-color] duration-150"
                  />
                </div>

                <div>
                  <label className={labelCls}>Alamat Rinci</label>
                  <textarea
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
                  <div className="flex-1">
                    <div className="text-sm font-bold leading-5 text-[#191C1E]">Status Akun</div>
                    <div className="mt-1 text-xs font-normal leading-4 text-[#4A4455]">
                      Menonaktifkan akun akan segera memutuskan semua sesi aktif dan mencegah
                      pengguna masuk kembali ke sistem.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive((a) => !a)}
                    role="switch"
                    aria-checked={isActive}
                    className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-[background] duration-200 ease-[ease] ${
                      isActive ? "bg-primary-700" : "bg-[#CBD5E1]"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ease-[ease] ${
                        isActive ? "left-7" : "left-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {submitError && (
                <div className="rounded-md border-l-4 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#7F1D1D]">
                  {submitError}
                </div>
              )}
            </div>
          </div>

          {/* Contacts card */}
          <div className="flex flex-col gap-6 rounded-lg bg-white p-8">
            <div className="flex items-start justify-between">
              <div>
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
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-semibold text-white ${gradientCls}`}
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
                          <label className={labelCls}>
                            Nama <span className="text-[#DC2626]">*</span>
                          </label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Jabatan</label>
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>No HP</label>
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ""))}
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Email</label>
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className={inputCls}
                          />
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
                          disabled={!editName.trim() || updateContact.isPending}
                          onClick={() => {
                            if (!editName.trim()) return
                            updateContact.mutate(
                              {
                                companyId: client.id,
                                contactId: c.id,
                                input: {
                                  name: editName.trim(),
                                  phone: editPhone.trim() || undefined,
                                  email: editEmail.trim() || undefined,
                                  title: editTitle.trim() || undefined,
                                },
                              },
                              { onSuccess: () => setEditingContactId(null) },
                            )
                          }}
                          className={contactSaveCls(Boolean(editName.trim()))}
                        >
                          {updateContact.isPending ? "Menyimpan..." : "Simpan"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-4 rounded-md bg-[#F2F4F6] px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#191C1E]">
                          {c.name}
                          {c.title && (
                            <span className="ml-2 text-xs font-normal text-dark-500">
                              {c.title}
                            </span>
                          )}
                        </div>
                        {(c.phone || c.email) && (
                          <div className="mt-0.5 text-xs text-dark-500">
                            {[c.phone, c.email].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => openEditContact(c)}
                          className="rounded-sm border-[1.5px] border-primary-700 px-3 py-1.5 text-xs font-semibold text-primary-700"
                        >
                          Ubah
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveContact(c.id)}
                          className="rounded-sm border-[1.5px] border-[#DC2626] px-3 py-1.5 text-xs font-semibold text-[#DC2626]"
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
                    <label className={labelCls}>
                      Nama <span className="text-[#DC2626]">*</span>
                    </label>
                    <input
                      type="text"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="Nama narahubung"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Jabatan</label>
                    <input
                      type="text"
                      value={newContactTitle}
                      onChange={(e) => setNewContactTitle(e.target.value)}
                      placeholder="Jabatan"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>No HP</label>
                    <input
                      type="text"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value.replace(/\D/g, ""))}
                      placeholder="-"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                      placeholder="email@perusahaan.com"
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={closeAddContactForm} className={contactCancelCls}>
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={!newContactName.trim() || createContact.isPending}
                    onClick={() => {
                      if (!newContactName.trim()) return
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
                        { onSuccess: closeAddContactForm },
                      )
                    }}
                    className={contactSaveCls(Boolean(newContactName.trim()))}
                  >
                    {createContact.isPending ? "Menyimpan..." : "Simpan"}
                  </button>
                </div>
              </div>
            )}

            {contactList.length === 0 && !contactFormOpen && (
              <div className="p-6 text-center text-sm text-[#94A3B8]">
                Belum ada narahubung. Klik Tambah Narahubung untuk menambahkan.
              </div>
            )}
          </div>

          <div className="mt-2 flex justify-end gap-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || updateClient.isPending}
              className={`rounded-lg bg-transparent px-7 py-3 text-sm font-bold ${
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
              className={`rounded-lg px-8 py-3 text-sm font-bold text-white ${
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
        </div>
      </div>
    </div>
  )
}
