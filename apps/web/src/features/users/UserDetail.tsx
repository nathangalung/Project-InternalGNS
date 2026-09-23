import { useEffect, useId, useRef, useState } from "react"
import { useMe } from "@/features/auth/hooks"
import { PartialUserUpdateError } from "@/features/users/api"
import ChangeOwnPasswordModal from "@/features/users/ChangeOwnPasswordModal"
import { formErrors, isInlineFormError } from "@/features/users/form-errors"
import { endsSessions } from "@/features/users/helpers"
import { useEndOwnSession, useUpdateUser } from "@/features/users/hooks"
import PasswordChecklist from "@/features/users/PasswordChecklist"
import PasswordInput from "@/features/users/PasswordInput"
import { passwordIsValid } from "@/features/users/password"
import { ui } from "@/lib/ui"
import type { Role, UserRow } from "@/types/api"

type UserDetailProps = {
  user: UserRow
  onBack: () => void
}

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  operational: "Operasional",
  finance: "Finance",
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "superadmin", label: "Super Admin" },
  { value: "finance", label: "Finance" },
  { value: "operational", label: "Operasional" },
]

const FIELDS = ["name", "email", "password", "role"] as const

type Field = (typeof FIELDS)[number]

const labelClass = "mb-2 block text-overline font-bold uppercase tracking-[1.1px] text-[#4A4455]"

const inputClass = `h-11 w-full rounded-md border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-[14px] font-medium text-[#191C1E] outline-none transition-colors duration-150 ${ui.fieldFocus}`

const fieldErrorClass = "mt-1.5 text-[12px] text-[#B91C1C]"

function borderFor(error: string | undefined): string {
  return error ? "border-[#DC2626]" : "border-transparent"
}

export default function UserDetail({ user, onBack }: UserDetailProps) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>(user.role)
  const [isActive, setIsActive] = useState(user.isActive)
  const [roleOpen, setRoleOpen] = useState(false)
  const [showChangeOwn, setShowChangeOwn] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})

  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const checklistId = useId()
  const roleId = useId()
  const statusId = useId()
  const statusHintId = useId()

  const roleRef = useRef<HTMLDivElement>(null)

  const { data: me } = useMe()
  const isSelf = me?.id === user.id
  const updateUser = useUpdateUser()
  const endSession = useEndOwnSession()

  useEffect(() => {
    setName(user.name)
    setEmail(user.email)
    setPassword("")
    setRole(user.role)
    setIsActive(user.isActive)
  }, [user.name, user.email, user.role, user.isActive])

  // Escape or outside click closes.
  useEffect(() => {
    if (!roleOpen) return
    const onPointer = (e: PointerEvent) => {
      if (roleRef.current && !roleRef.current.contains(e.target as Node)) setRoleOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRoleOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [roleOpen])

  const dirty =
    name !== user.name ||
    email !== user.email ||
    role !== user.role ||
    isActive !== user.isActive ||
    password.length > 0

  const willEndSessions = endsSessions(user, { role, isActive, password })

  const clearField = (field: Field) => {
    setFieldErrors((p) => ({ ...p, [field]: undefined }))
  }

  const handleCancel = () => {
    setName(user.name)
    setEmail(user.email)
    setPassword("")
    setRole(user.role)
    setIsActive(user.isActive)
    setFieldErrors({})
    setSubmitError(null)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const errs: Partial<Record<Field, string>> = {}
    if (!name.trim()) errs.name = "Nama wajib diisi."
    if (!email.trim()) errs.email = "Email wajib diisi."
    if (password.length > 0 && !passwordIsValid(password))
      errs.password = "Kata sandi belum memenuhi semua aturan."
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    const endsOwnSession = isSelf && willEndSessions
    try {
      await updateUser.mutateAsync({
        id: user.id,
        input: {
          name: name.trim(),
          email: email.trim(),
          role,
          isActive,
          ...(password ? { password } : {}),
        },
        endsOwnSession,
      })
      if (endsOwnSession) {
        endSession("Akses akun Anda berubah. Silakan masuk kembali.")
        return
      }
      setPassword("")
      setFieldErrors({})
    } catch (err) {
      if (err instanceof PartialUserUpdateError) {
        const split = formErrors(err.passwordError, FIELDS, "Kata sandi gagal diperbarui.")
        setFieldErrors(split.fields)
        setSubmitError(
          `Profil tersimpan, tetapi kata sandi gagal diperbarui.${split.banner ? ` ${split.banner}` : ""}`,
        )
        return
      }
      // Other failures are toasted by the hook.
      if (!isInlineFormError(err)) return
      const split = formErrors(err, FIELDS, "Gagal menyimpan perubahan.")
      setFieldErrors(split.fields)
      setSubmitError(split.banner)
    }
  }

  return (
    <div className={ui.pageContent}>
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className={ui.breadcrumb}>
          <button type="button" className={ui.breadcrumbLink} onClick={onBack}>
            Manajemen Pengguna
          </button>
          <span className={ui.breadcrumbSep} aria-hidden="true">
            &rsaquo;
          </span>
          <span className={ui.breadcrumbCurrent} aria-current="page">
            Detail Pengguna
          </span>
        </nav>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Kembali ke Daftar Pengguna"
            title="Kembali"
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
          </button>
          <h1 className={ui.pageTitle}>Detail Pengguna</h1>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dark-100">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="24" r="12" fill="#191C1E" />
              <path
                d="M12 56 C12 44, 21 39, 32 39 C43 39, 52 44, 52 56 L52 60 C52 62, 50 64, 48 64 L16 64 C14 64, 12 62, 12 60 Z"
                fill="#191C1E"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 break-words text-[18px] font-bold leading-6 tracking-[-0.4px] text-[#191C1E]">
              {user.name}
            </h2>
            <span className="text-[13px] font-medium leading-[18px] text-[#4A4455]">
              {ROLE_LABEL[user.role]}
            </span>
          </div>
          <div
            className={`flex shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 ${
              user.isActive ? "border-[#BBF7D0] bg-[#F0FDF4]" : "border-[#FECACA] bg-[#FEF2F2]"
            }`}
          >
            <span className="text-[9px] font-semibold uppercase leading-[11px] tracking-[1.4px] text-dark-500">
              Status
            </span>
            <span
              className={`text-[13px] font-extrabold leading-4 tracking-[0.2px] ${
                user.isActive ? "text-[#065F46]" : "text-[#991B1B]"
              }`}
            >
              {user.isActive ? "Aktif" : "Nonaktif"}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-8 rounded-lg bg-white p-8">
          <div>
            <h3 className="m-0 text-[20px] font-bold leading-7 tracking-[-0.5px] text-[#191C1E]">
              Data Personal &amp; Akses
            </h3>
            <p className="mt-1 text-[14px] font-normal leading-5 text-[#4A4455]">
              Kelola informasi dan hak akses pengguna.
            </p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-x-8 gap-y-6">
            <div>
              <label htmlFor={nameId} className={labelClass}>
                Nama Lengkap
              </label>
              <input
                id={nameId}
                type="text"
                value={name}
                autoComplete="off"
                aria-invalid={!!fieldErrors.name || undefined}
                aria-describedby={fieldErrors.name ? `${nameId}-err` : undefined}
                onChange={(e) => {
                  setName(e.target.value)
                  clearField("name")
                }}
                className={`${inputClass} ${borderFor(fieldErrors.name)}`}
              />
              {fieldErrors.name && (
                <div id={`${nameId}-err`} className={fieldErrorClass}>
                  {fieldErrors.name}
                </div>
              )}
            </div>

            <div>
              <label htmlFor={emailId} className={labelClass}>
                Alamat Email
              </label>
              <input
                id={emailId}
                type="email"
                value={email}
                autoComplete="off"
                aria-invalid={!!fieldErrors.email || undefined}
                aria-describedby={fieldErrors.email ? `${emailId}-err` : undefined}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearField("email")
                }}
                className={`${inputClass} ${borderFor(fieldErrors.email)}`}
              />
              {fieldErrors.email && (
                <div id={`${emailId}-err`} className={fieldErrorClass}>
                  {fieldErrors.email}
                </div>
              )}
            </div>

            {isSelf ? (
              <div>
                <span className={labelClass}>Kata Sandi</span>
                <button
                  type="button"
                  className={`${ui.btnOutline} h-11 w-full`}
                  onClick={() => setShowChangeOwn(true)}
                >
                  Ubah Kata Sandi
                </button>
                <p className="mt-1.5 text-[12px] text-[#4A4455]">Memerlukan kata sandi saat ini.</p>
              </div>
            ) : (
              <div>
                <label htmlFor={passwordId} className={labelClass}>
                  Kata Sandi Baru
                </label>
                <PasswordInput
                  id={passwordId}
                  value={password}
                  onChange={(v) => {
                    setPassword(v)
                    clearField("password")
                  }}
                  autoComplete="new-password"
                  className={`${inputClass} ${borderFor(fieldErrors.password)}`}
                  invalid={!!fieldErrors.password}
                  describedBy={
                    fieldErrors.password ? `${passwordId}-err ${checklistId}` : checklistId
                  }
                />
                {fieldErrors.password && (
                  <div id={`${passwordId}-err`} className={fieldErrorClass}>
                    {fieldErrors.password}
                  </div>
                )}
                <PasswordChecklist id={checklistId} value={password} />
              </div>
            )}

            <div>
              <label id={`${roleId}-label`} htmlFor={roleId} className={labelClass}>
                Peran
              </label>
              <div ref={roleRef} className="relative">
                <button
                  id={roleId}
                  type="button"
                  className={ui.selectBtn}
                  aria-haspopup="true"
                  // Label plus current value.
                  aria-labelledby={`${roleId}-label ${roleId}-value`}
                  aria-expanded={roleOpen}
                  onClick={() => setRoleOpen((o) => !o)}
                >
                  <span id={`${roleId}-value`}>{ROLE_LABEL[role]}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {roleOpen && (
                  <div className={ui.dropdownPanel}>
                    {ROLE_OPTIONS.map((opt) => {
                      const active = role === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={ui.dropdownItem}
                          aria-pressed={active}
                          onClick={() => {
                            setRole(opt.value)
                            clearField("role")
                            setRoleOpen(false)
                          }}
                        >
                          <span
                            className={`text-[14px] ${
                              active ? "font-bold text-primary-700" : "font-medium text-[#4A4455]"
                            }`}
                          >
                            {opt.label}
                          </span>
                          {active && (
                            <svg
                              width="14"
                              height="11"
                              viewBox="0 0 14 11"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M1 5.5L4.5 9L13 1"
                                stroke="#630ED4"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {fieldErrors.role && <div className={fieldErrorClass}>{fieldErrors.role}</div>}
            </div>
          </div>

          <div className="border-t border-[#ECEEF0] pt-6">
            <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5">
              <div className="flex-1">
                <div id={statusId} className="text-[14px] font-bold leading-5 text-[#191C1E]">
                  Status Akun
                </div>
                <div
                  id={statusHintId}
                  className="mt-1 text-[12px] font-normal leading-4 text-[#4A4455]"
                >
                  Menonaktifkan akun akan segera memutuskan semua sesi aktif dan mencegah pengguna
                  masuk kembali ke sistem.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                role="switch"
                aria-checked={isActive}
                aria-labelledby={statusId}
                aria-describedby={statusHintId}
                className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${ui.focusRing} ${
                  isActive ? "bg-primary-700" : "bg-dark-300"
                }`}
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 motion-reduce:transition-none ${
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

      <div className="flex flex-wrap items-center justify-end gap-4">
        {dirty && willEndSessions && (
          <p className="mr-auto text-[13px] text-[#92400E]">
            {isSelf
              ? "Perubahan ini mengakhiri sesi Anda. Anda perlu masuk kembali."
              : "Pengguna akan keluar dari semua sesi."}
          </p>
        )}
        <div className="flex gap-4 max-sm:w-full">
          <button
            type="button"
            onClick={handleCancel}
            disabled={!dirty || updateUser.isPending}
            className={`${ui.modalCancel} whitespace-nowrap disabled:cursor-default disabled:text-dark-300 disabled:hover:bg-transparent max-sm:flex-1 max-sm:px-4`}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!dirty || updateUser.isPending}
            className={`${ui.modalSubmit} whitespace-nowrap max-sm:flex-1 max-sm:px-4`}
          >
            {updateUser.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </button>
        </div>
      </div>

      {showChangeOwn && <ChangeOwnPasswordModal onClose={() => setShowChangeOwn(false)} />}
    </div>
  )
}
