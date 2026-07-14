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
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#EF4444",
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    {emailError}
                  </span>
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
              <div style={{ position: "relative" }}>
                <input
                  className="ca-input"
                  type={showPwd ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: "44px" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#94A3B8",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                  }}
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
              <div className="rgrid-3" style={{ display: "grid", gap: "12px" }}>
                {ROLE_CARDS.map((card) => {
                  const isActive = role === card.value
                  return (
                    <button
                      key={card.value}
                      type="button"
                      onClick={() => setRole(card.value)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "14px 12px",
                        borderRadius: "8px",
                        border: "none",
                        background: isActive ? "#EADDFF" : "#F2F4F6",
                        boxShadow: isActive ? "0 0 0 1.5px rgba(99, 14, 212, 0.4)" : "none",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: isActive ? 700 : 500,
                        fontSize: "13px",
                        letterSpacing: "-0.2px",
                        color: isActive ? "#5B21B6" : "#191C1E",
                        transition: "all 0.15s",
                      }}
                    >
                      {card.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 14px",
                background: "#F2F4F6",
                border: "1px solid rgba(204, 195, 216, 0.1)",
                borderRadius: "8px",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "13px",
                    lineHeight: "18px",
                    color: "#191C1E",
                  }}
                >
                  Status Aktif
                </div>
                <div
                  style={{
                    marginTop: "2px",
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 400,
                    fontSize: "12px",
                    lineHeight: "16px",
                    color: "#4A4455",
                  }}
                >
                  Pengguna dapat langsung login dan mengakses sistem.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                role="switch"
                aria-checked={isActive}
                style={{
                  width: "40px",
                  height: "22px",
                  borderRadius: "999px",
                  border: "none",
                  background: isActive ? "#630ED4" : "#CBD5E1",
                  cursor: "pointer",
                  position: "relative",
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "2px",
                    left: isActive ? "20px" : "2px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="ca-footer" style={{ padding: "16px 24px" }}>
          {submitError && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>{submitError}</span>
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
            disabled={!canSubmit || isSaving}
            style={{
              padding: "8px 22px",
              fontSize: "13px",
              opacity: !canSubmit || isSaving ? 0.5 : 1,
              cursor: !canSubmit || isSaving ? "not-allowed" : "pointer",
            }}
          >
            {isSaving ? "Menyimpan..." : "Simpan Akun"}
          </button>
        </div>
      </div>
    </div>
  )
}
