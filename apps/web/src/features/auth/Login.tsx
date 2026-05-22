import { type FormEvent, useState } from "react"
import EyeIcon from "@/components/shared/EyeIcon"

const logoImg = "/logo.png"

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [emailError, setEmailError] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const validateEmail = (value: string) => {
    if (!value) {
      setEmailError("")
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(value)) {
      setEmailError("Format surel tidak valid")
      return false
    }
    setEmailError("")
    return true
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    setPasswordError("")
    validateEmail(value)
  }

  const handlePasswordChange = (value: string) => {
    setPassword(value)
    setPasswordError("")
    if (emailError && emailError !== "Format surel tidak valid") {
      setEmailError("")
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validateEmail(email)) return
    if (!password) return
    try {
      await onLogin(email, password)
    } catch (err) {
      const message = (err instanceof Error ? err.message : "").toLowerCase()
      if (message.includes("email not registered")) {
        setEmailError("Surel belum terdaftar")
        setPasswordError("")
      } else if (
        message.includes("invalid password") ||
        message.includes("invalid email or password")
      ) {
        setEmailError("")
        setPasswordError("Kata sandi salah")
      } else {
        setPasswordError(err instanceof Error ? err.message : "Gagal masuk")
      }
    }
  }

  return (
    <div className="login-page">
      {/* Left Panel */}
      <div className="login-left">
        <img className="login-logo-bg" src={logoImg} alt="" />
        <div className="login-brand">
          <h1>PT Global Niaga Sakti</h1>
          <p>Admin Panel</p>
        </div>
      </div>

      {/* Right Panel */}
      <div className="login-right">
        <div className="login-form-wrapper">
          <h2>Halo!</h2>
          <p className="login-subtitle">Masukkan kredensial Anda untuk mengakses dasbor.</p>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div className="form-group">
              <label className="form-label" htmlFor="email">
                Surel
              </label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M16 8v5a3 3 0 0 0 6 0V12a10 10 0 1 0-4 8" />
                  </svg>
                </span>
                <input
                  className="form-input"
                  type="email"
                  id="email"
                  placeholder="nama@gmail.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                />
              </div>
              {emailError && <span className="error-text">{emailError}</span>}
            </div>

            {/* Password */}
            <div className="form-group">
              <label className="form-label" htmlFor="password">
                Kata Sandi
              </label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  className="form-input"
                  type={showPassword ? "text" : "password"}
                  id="password"
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  title={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-dark-400)",
                  }}
                >
                  {showPassword ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-3.17 4.19" />
                      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <EyeIcon size={18} strokeWidth={1.8} />
                  )}
                </button>
              </div>
              {passwordError && <span className="error-text">{passwordError}</span>}
            </div>

            {/* Submit */}
            <button
              className="btn btn-primary btn-full btn-login"
              type="submit"
              disabled={!email || !password || !!emailError}
            >
              Masuk
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
