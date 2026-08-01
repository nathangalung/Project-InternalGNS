import { type FormEvent, useState } from "react"
import EyeIcon from "@/components/shared/EyeIcon"

const logoImg = "/logo.png"

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>
}

const fieldClass =
  "w-full rounded-lg border-[1.5px] border-transparent bg-dark-100 py-3.5 pl-11 pr-4 text-base text-dark-900 outline-none transition placeholder:text-dark-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"
const labelClass =
  "mb-2 block text-overline font-semibold uppercase tracking-[0.06em] text-dark-600"

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
      if (message.includes("invalid password") || message.includes("invalid email or password")) {
        // Backend no longer says whether the email exists; keep it neutral.
        setEmailError("")
        setPasswordError("Surel atau kata sandi salah")
      } else {
        setPasswordError(err instanceof Error ? err.message : "Gagal masuk")
      }
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden flex-[0_0_45%] max-w-[45%] flex-col items-center justify-center overflow-hidden bg-[linear-gradient(160deg,var(--color-primary-400)_0%,var(--color-primary-600)_40%,var(--color-primary-800)_100%)] p-12 md:flex">
        <img
          className="pointer-events-none absolute left-1/2 top-1/2 h-[170%] w-[170%] -translate-x-1/2 -translate-y-1/2 object-contain opacity-30"
          src={logoImg}
          alt=""
        />
        <div className="relative z-10 text-center [text-shadow:0_2px_8px_rgba(0,0,0,0.3)]">
          <h1 className="text-3xl font-bold tracking-tight text-white">PT Global Niaga Sakti</h1>
          <p className="mt-1 text-lg text-white/80">Admin Panel</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[420px]">
          <h2 className="mb-2 text-3xl font-bold text-dark-900">Halo!</h2>
          <p className="mb-10 text-base text-dark-500">
            Masukkan kredensial Anda untuk mengakses dasbor.
          </p>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div className="mb-5">
              <label className={labelClass} htmlFor="email">
                Surel
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-4 flex h-[18px] w-[18px] items-center justify-center text-dark-400 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-width:1.8] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M16 8v5a3 3 0 0 0 6 0V12a10 10 0 1 0-4 8" />
                  </svg>
                </span>
                <input
                  className={fieldClass}
                  type="email"
                  id="email"
                  placeholder="nama@gmail.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                />
              </div>
              {emailError && (
                <span className="mt-1 block text-caption text-error">{emailError}</span>
              )}
            </div>

            {/* Password */}
            <div className="mb-5">
              <label className={labelClass} htmlFor="password">
                Kata Sandi
              </label>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-4 flex h-[18px] w-[18px] items-center justify-center text-dark-400 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-width:1.8] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]">
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  className={`${fieldClass} pr-11`}
                  type={showPassword ? "text" : "password"}
                  id="password"
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  title={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-1 text-dark-400 transition hover:text-dark-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40"
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
              {passwordError && (
                <span className="mt-1 block text-caption text-error">{passwordError}</span>
              )}
            </div>

            {/* Submit */}
            <button
              className="mt-3 flex w-full items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--color-primary-600)_0%,var(--color-primary-900)_100%)] px-4 py-3.5 text-base font-semibold text-white transition hover:opacity-95 hover:shadow-[0_4px_14px_rgba(124,58,237,0.35)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40 focus-visible:ring-offset-2"
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
