import { useEffect, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { PartialUserUpdateError } from "@/features/users/api"
import { useUpdateUser } from "@/features/users/hooks"
import PasswordChecklist from "@/features/users/PasswordChecklist"
import { passwordIsValid } from "@/features/users/password"
import { ApiError } from "@/lib/api-client"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import type { Role, UserRow } from "@/types/api"

interface UserDetailProps {
  user: UserRow
  isLoading?: boolean
  onNavigate: (page: Page) => void
  onBack: () => void
  onLogout: () => void
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

const labelClass = "mb-2 block text-overline font-bold uppercase tracking-[1.1px] text-[#4A4455]"

const inputClass =
  "h-11 w-full rounded-md border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-[14px] font-medium text-[#191C1E] outline-none transition-colors duration-150"

const fieldErrorClass = "mt-1.5 text-[12px] text-[#DC2626]"

// Faithful port of the legacy .ca-select-btn
const selectBtnClass =
  "flex w-full cursor-pointer items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition-colors duration-200 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"

export default function UserDetail({ user, onNavigate, onBack, onLogout }: UserDetailProps) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [role, setRole] = useState<Role>(user.role)
  const [isActive, setIsActive] = useState(user.isActive)
  const [roleOpen, setRoleOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const updateUser = useUpdateUser()

  useEffect(() => {
    setName(user.name)
    setEmail(user.email)
    setPassword("")
    setRole(user.role)
    setIsActive(user.isActive)
  }, [user.name, user.email, user.role, user.isActive])

  const dirty =
    name !== user.name ||
    email !== user.email ||
    role !== user.role ||
    isActive !== user.isActive ||
    password.length > 0

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
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = "Wajib diisi"
    if (!email.trim()) errs.email = "Wajib diisi"
    if (password.length > 0 && !passwordIsValid(password))
      errs.password = "Kata sandi belum memenuhi semua aturan"
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
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
      })
      setPassword("")
      setFieldErrors({})
    } catch (err) {
      if (err instanceof PartialUserUpdateError) {
        setSubmitError("Profil tersimpan, tetapi kata sandi gagal diperbarui.")
      } else if (err instanceof ApiError) {
        setSubmitError(err.message || "Gagal menyimpan perubahan")
      } else {
        setSubmitError("Gagal menyimpan perubahan")
      }
    }
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"users" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div className="flex flex-col gap-3">
            <nav className={ui.breadcrumb}>
              <button className={ui.breadcrumbLink} onClick={onBack}>
                Manajemen Pengguna
              </button>
              <span className={ui.breadcrumbSep}>&rsaquo;</span>
              <span className={ui.breadcrumbCurrent}>Detail Pengguna</span>
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
              <h1 className="page-title m-0">Detail Pengguna</h1>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dark-100">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
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
                  <label className={labelClass}>Nama Lengkap</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFieldErrors((p) => ({ ...p, name: "" }))
                    }}
                    className={`${inputClass} ${
                      fieldErrors.name ? "border-[#DC2626]" : "border-transparent"
                    }`}
                  />
                  {fieldErrors.name && <div className={fieldErrorClass}>{fieldErrors.name}</div>}
                </div>

                <div>
                  <label className={labelClass}>Alamat Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setFieldErrors((p) => ({ ...p, email: "" }))
                    }}
                    className={`${inputClass} ${
                      fieldErrors.email ? "border-[#DC2626]" : "border-transparent"
                    }`}
                  />
                  {fieldErrors.email && <div className={fieldErrorClass}>{fieldErrors.email}</div>}
                </div>

                <div>
                  <label className={labelClass}>Kata Sandi</label>
                  <div className="relative">
                    <input
                      type={showPwd ? "text" : "password"}
                      value={password}
                      placeholder="••••••••"
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setFieldErrors((p) => ({ ...p, password: "" }))
                      }}
                      className={`${inputClass} pr-12 ${
                        fieldErrors.password ? "border-[#DC2626]" : "border-transparent"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center p-0 text-dark-400"
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <svg
                          width="20"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg
                          width="20"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <div className={fieldErrorClass}>{fieldErrors.password}</div>
                  )}
                  <PasswordChecklist value={password} />
                </div>

                <div>
                  <label className={labelClass}>Peran</label>
                  <div className="relative">
                    <button
                      type="button"
                      className={selectBtnClass}
                      onClick={() => setRoleOpen((o) => !o)}
                    >
                      <span>{ROLE_LABEL[role]}</span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {roleOpen && (
                      <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 flex flex-col rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                        {ROLE_OPTIONS.map((opt) => {
                          const active = role === opt.value
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left"
                              onClick={() => {
                                setRole(opt.value)
                                setRoleOpen(false)
                              }}
                            >
                              <span
                                className={`text-[14px] ${
                                  active ? "font-bold text-[#630ED4]" : "font-medium text-[#4A4455]"
                                }`}
                              >
                                {opt.label}
                              </span>
                              {active && (
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
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
                </div>
              </div>

              <div className="border-t border-[#ECEEF0] pt-6">
                <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5">
                  <div className="flex-1">
                    <div className="text-[14px] font-bold leading-5 text-[#191C1E]">
                      Status Akun
                    </div>
                    <div className="mt-1 text-[12px] font-normal leading-4 text-[#4A4455]">
                      Menonaktifkan akun akan segera memutuskan semua sesi aktif dan mencegah
                      pengguna masuk kembali ke sistem.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive((a) => !a)}
                    role="switch"
                    aria-checked={isActive}
                    className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 ${
                      isActive ? "bg-[#630ED4]" : "bg-dark-300"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ${
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

          <div className="mt-2 flex justify-end gap-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || updateUser.isPending}
              className={`rounded-lg px-7 py-3 text-[14px] font-bold ${
                dirty && !updateUser.isPending
                  ? "cursor-pointer text-[#630ED4]"
                  : "cursor-default text-dark-300"
              }`}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateUser.isPending}
              className={`rounded-lg px-8 py-3 text-[14px] font-bold text-white ${
                dirty
                  ? "bg-[linear-gradient(135deg,#630ED4_0%,#7C3AED_100%)] shadow-[0px_10px_15px_-3px_rgba(99,14,212,0.2),0px_4px_6px_-4px_rgba(99,14,212,0.2)]"
                  : "bg-dark-300"
              } ${dirty && !updateUser.isPending ? "cursor-pointer" : "cursor-default"} ${
                updateUser.isPending ? "opacity-70" : ""
              }`}
            >
              {updateUser.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
