import { useState } from "react"
import { useCreateUser } from "@/features/users/hooks"
import PasswordChecklist from "@/features/users/PasswordChecklist"
import { passwordIsValid } from "@/features/users/password"
import { ApiError } from "@/lib/api-client"
import type { Role } from "@/types/api"

interface UserAddModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface RoleCard {
  value: Role
  label: string
}

const ROLE_CARDS: RoleCard[] = [
  { value: "superadmin", label: "Super Admin" },
  { value: "finance", label: "Finance" },
  { value: "operational", label: "Operasional" },
]

function isValidEmail(s: string): boolean {
  return s.includes("@") && s.split("@").length === 2 && s.split("@")[1].includes(".")
}

export default function UserAddModal({ open, onOpenChange }: UserAddModalProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPwd, setShowPwd] = useState(false)
  const [role, setRole] = useState<Role>("superadmin")
  const [isActive, setIsActive] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const createUser = useCreateUser()
  const isSaving = createUser.isPending

  if (!open) return null

  const isNameFilled = name.trim().length > 0
  const isEmailValid = email.trim().length > 0 && isValidEmail(email)
  const isPasswordValid = passwordIsValid(password)
  const emailError =
    email.trim().length > 0 && !isValidEmail(email) ? "Format email tidak valid." : null
  const canSubmit = isNameFilled && isEmailValid && isPasswordValid

  const reset = () => {
    setName("")
    setEmail("")
    setPassword("")
    setShowPwd(false)
    setRole("superadmin")
    setIsActive(true)
    setSubmitError(null)
  }

  const handleCancel = () => {
    if (isSaving) return
    reset()
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (!canSubmit) return
    try {
      await createUser.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        isActive,
      })
      reset()
      onOpenChange(false)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message || "Gagal menyimpan pengguna."
          : "Gagal menyimpan pengguna."
      setSubmitError(msg)
    }
  }

  return (
    <div className="ca-overlay" onClick={handleCancel}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Tambah Pengguna</h2>
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
          <div className="ca-section">
            <div className="ca-section-heading">Identitas Pengguna</div>
            <div className="ca-row-2">
              <div className="ca-field">
                <label className="ca-label">
                  Nama Lengkap <span className="ca-required">*</span>
                </label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="Contoh: Budi Santoso"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="ca-field">
                <label className="ca-label">
                  Alamat Email <span className="ca-required">*</span>
                </label>
                <input
                  className="ca-input"
                  type="email"
                  placeholder="email@ptglobal.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {emailError && (
                  <span className="mt-1 block text-[12px] text-error">{emailError}</span>
                )}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Kata Sandi</div>
            <div className="ca-field">
              <label className="ca-label">
                Kata Sandi <span className="ca-required">*</span>
              </label>
              <div className="relative">
                <input
                  className="ca-input pr-11"
                  type={showPwd ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center p-1 text-dark-400"
                  tabIndex={-1}
                  title={showPwd ? "Sembunyikan" : "Tampilkan"}
                >
                  {showPwd ? (
                    <svg
                      width="18"
                      height="14"
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
                      width="18"
                      height="14"
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
              <PasswordChecklist value={password} />
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Peran</div>
            <div className="ca-field">
              <div className="rgrid-3 grid gap-3">
                {ROLE_CARDS.map((card) => {
                  const isActive = role === card.value
                  return (
                    <button
                      key={card.value}
                      type="button"
                      onClick={() => setRole(card.value)}
                      className={`flex items-center justify-center rounded-md px-3 py-[14px] text-[13px] tracking-[-0.2px] transition-all duration-150 ${
                        isActive
                          ? "bg-[#EADDFF] font-bold text-primary-800 shadow-[0_0_0_1.5px_rgba(99,14,212,0.4)]"
                          : "bg-[#F2F4F6] font-medium text-[#191C1E]"
                      }`}
                    >
                      {card.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="flex items-center justify-between gap-3 rounded-md border border-[rgba(204,195,216,0.1)] bg-[#F2F4F6] px-[14px] py-2.5">
              <div className="flex-1">
                <div className="text-[13px] font-bold leading-[18px] text-[#191C1E]">
                  Status Aktif
                </div>
                <div className="mt-0.5 text-[12px] font-normal leading-4 text-[#4A4455]">
                  Pengguna dapat langsung login dan mengakses sistem.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                role="switch"
                aria-checked={isActive}
                className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 ${
                  isActive ? "bg-[#630ED4]" : "bg-dark-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ${
                    isActive ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="ca-footer px-6 py-4">
          {submitError && <span className="flex-1 text-[12px] text-error">{submitError}</span>}
          <button
            type="button"
            className="ca-btn-cancel px-[18px] py-2 text-[13px]"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit px-[22px] py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleSubmit}
            disabled={!canSubmit || isSaving}
          >
            {isSaving ? "Menyimpan..." : "Simpan Akun"}
          </button>
        </div>
      </div>
    </div>
  )
}
