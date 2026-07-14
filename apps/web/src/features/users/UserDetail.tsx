import { type CSSProperties, useEffect, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import { PartialUserUpdateError } from "@/features/users/api"
import { useUpdateUser } from "@/features/users/hooks"
import PasswordChecklist from "@/features/users/PasswordChecklist"
import { passwordIsValid } from "@/features/users/password"
import { ApiError } from "@/lib/api-client"
import type { Page } from "@/lib/page"
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

const labelStyle: CSSProperties = {
  fontFamily: "'Inter', sans-serif",
  fontWeight: 700,
  fontSize: "11px",
  lineHeight: "16px",
  letterSpacing: "1.1px",
  textTransform: "uppercase",
  color: "#4A4455",
  display: "block",
  marginBottom: "8px",
}

const inputStyle: CSSProperties = {
  width: "100%",
  height: "44px",
  padding: "12px 16px",
  background: "#F2F4F6",
  borderRadius: "8px",
  border: "1.5px solid transparent",
  fontFamily: "'Inter', sans-serif",
  fontSize: "14px",
  fontWeight: 500,
  color: "#191C1E",
  outline: "none",
  transition: "border-color 0.15s",
}

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
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <nav className="qd-breadcrumb">
              <button className="qd-breadcrumb-link" onClick={onBack}>
                Manajemen Pengguna
              </button>
              <span className="qd-breadcrumb-sep">&rsaquo;</span>
              <span className="qd-breadcrumb-current">Detail Pengguna</span>
            </nav>

            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <button
                type="button"
                onClick={onBack}
                style={{
                  width: "40px",
                  height: "40px",
                  background: "#FFFFFF",
                  boxShadow: "0px 1px 2px rgba(0, 0, 0, 0.05)",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
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
              <h1 className="page-title" style={{ margin: 0 }}>
                Detail Pengguna
              </h1>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                background: "#FFFFFF",
                borderRadius: "12px",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                gap: "20px",
              }}
            >
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "12px",
                  background: "#F1F5F9",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <circle cx="32" cy="24" r="12" fill="#191C1E" />
                  <path
                    d="M12 56 C12 44, 21 39, 32 39 C43 39, 52 44, 52 56 L52 60 C52 62, 50 64, 48 64 L16 64 C14 64, 12 62, 12 60 Z"
                    fill="#191C1E"
                  />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "18px",
                    lineHeight: "24px",
                    letterSpacing: "-0.4px",
                    color: "#191C1E",
                    wordBreak: "break-word",
                  }}
                >
                  {user.name}
                </h2>
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 500,
                    fontSize: "13px",
                    lineHeight: "18px",
                    color: "#4A4455",
                  }}
                >
                  {ROLE_LABEL[user.role]}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "10px 16px",
                  background: user.isActive ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${user.isActive ? "#BBF7D0" : "#FECACA"}`,
                  borderRadius: "10px",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 600,
                    fontSize: "9px",
                    letterSpacing: "1.4px",
                    textTransform: "uppercase",
                    color: "#64748B",
                    lineHeight: "11px",
                  }}
                >
                  Status
                </span>
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 800,
                    fontSize: "13px",
                    letterSpacing: "0.2px",
                    color: user.isActive ? "#065F46" : "#991B1B",
                    lineHeight: "16px",
                  }}
                >
                  {user.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
            </div>

            <div
              style={{
                background: "#FFFFFF",
                borderRadius: "12px",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "20px",
                    lineHeight: "28px",
                    letterSpacing: "-0.5px",
                    color: "#191C1E",
                  }}
                >
                  Data Personal &amp; Akses
                </h3>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 400,
                    fontSize: "14px",
                    lineHeight: "20px",
                    color: "#4A4455",
                  }}
                >
                  Kelola informasi dan hak akses pengguna.
                </p>
              </div>

              <div className="rgrid-2" style={{ display: "grid", gap: "24px 32px" }}>
                <div>
                  <label style={labelStyle}>Nama Lengkap</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFieldErrors((p) => ({ ...p, name: "" }))
                    }}
                    style={{
                      ...inputStyle,
                      borderColor: fieldErrors.name ? "#DC2626" : "transparent",
                    }}
                  />
                  {fieldErrors.name && (
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        color: "#DC2626",
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      {fieldErrors.name}
                    </div>
                  )}
                </div>

                <div>
                  <label style={labelStyle}>Alamat Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setFieldErrors((p) => ({ ...p, email: "" }))
                    }}
                    style={{
                      ...inputStyle,
                      borderColor: fieldErrors.email ? "#DC2626" : "transparent",
                    }}
                  />
                  {fieldErrors.email && (
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        color: "#DC2626",
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      {fieldErrors.email}
                    </div>
                  )}
                </div>

                <div>
                  <label style={labelStyle}>Kata Sandi</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPwd ? "text" : "password"}
                      value={password}
                      placeholder="••••••••"
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setFieldErrors((p) => ({ ...p, password: "" }))
                      }}
                      style={{
                        ...inputStyle,
                        paddingRight: "48px",
                        borderColor: fieldErrors.password ? "#DC2626" : "transparent",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      style={{
                        position: "absolute",
                        right: "16px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: "#94A3B8",
                        padding: 0,
                        display: "flex",
                        alignItems: "center",
                      }}
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
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        color: "#DC2626",
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      {fieldErrors.password}
                    </div>
                  )}
                  <PasswordChecklist value={password} />
                </div>

                <div>
                  <label style={labelStyle}>Peran</label>
                  <div className="ca-select-wrapper" style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="ca-select-btn"
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
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          background: "#FFFFFF",
                          border: "1px solid rgba(204, 195, 216, 0.2)",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                          borderRadius: "8px",
                          display: "flex",
                          flexDirection: "column",
                          padding: "8px 0",
                          zIndex: 50,
                        }}
                      >
                        {ROLE_OPTIONS.map((opt) => {
                          const active = role === opt.value
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "12px",
                                padding: "10px 20px",
                                width: "100%",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                              onClick={() => {
                                setRole(opt.value)
                                setRoleOpen(false)
                              }}
                            >
                              <span
                                style={{
                                  fontFamily: "'Inter', sans-serif",
                                  fontWeight: active ? 700 : 500,
                                  fontSize: "14px",
                                  color: active ? "#630ED4" : "#4A4455",
                                }}
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

              <div style={{ borderTop: "1px solid #ECEEF0", paddingTop: "24px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "24px",
                    padding: "20px 24px",
                    background: "#F2F4F6",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: 700,
                        fontSize: "14px",
                        lineHeight: "20px",
                        color: "#191C1E",
                      }}
                    >
                      Status Akun
                    </div>
                    <div
                      style={{
                        marginTop: "4px",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: 400,
                        fontSize: "12px",
                        lineHeight: "16px",
                        color: "#4A4455",
                      }}
                    >
                      Menonaktifkan akun akan segera memutuskan semua sesi aktif dan mencegah
                      pengguna masuk kembali ke sistem.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive((a) => !a)}
                    role="switch"
                    aria-checked={isActive}
                    style={{
                      width: "56px",
                      height: "32px",
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
                        top: "4px",
                        left: isActive ? "28px" : "4px",
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        background: "#FFFFFF",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                      }}
                    />
                  </button>
                </div>
              </div>

              {submitError && (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "#FEF2F2",
                    borderLeft: "4px solid #DC2626",
                    borderRadius: "8px",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: "13px",
                    color: "#7F1D1D",
                  }}
                >
                  {submitError}
                </div>
              )}
            </div>
          </div>

          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: "16px", marginTop: "8px" }}
          >
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || updateUser.isPending}
              style={{
                padding: "12px 28px",
                borderRadius: "12px",
                border: "none",
                background: "transparent",
                color: dirty && !updateUser.isPending ? "#630ED4" : "#CBD5E1",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "14px",
                cursor: dirty && !updateUser.isPending ? "pointer" : "default",
              }}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateUser.isPending}
              style={{
                padding: "12px 32px",
                borderRadius: "12px",
                border: "none",
                background: dirty ? "linear-gradient(135deg, #630ED4 0%, #7C3AED 100%)" : "#CBD5E1",
                boxShadow: dirty
                  ? "0px 10px 15px -3px rgba(99, 14, 212, 0.2), 0px 4px 6px -4px rgba(99, 14, 212, 0.2)"
                  : "none",
                color: "#FFFFFF",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "14px",
                cursor: dirty && !updateUser.isPending ? "pointer" : "default",
                opacity: updateUser.isPending ? 0.7 : 1,
              }}
            >
              {updateUser.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
