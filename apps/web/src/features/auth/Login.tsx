import { useState, type FormEvent } from "react";

const logoImg = "/logo.png";

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");

  const validateEmail = (value: string) => {
    if (!value) {
      setEmailError("");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      setEmailError("Format surel tidak valid");
      return false;
    }
    setEmailError("");
    return true;
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    validateEmail(value);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) return;
    if (!password) return;
    try {
      await onLogin(email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal masuk";
      setEmailError(message);
    }
  };

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
          <p className="login-subtitle">
            Masukkan kredensial Anda untuk mengakses dasbor.
          </p>

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
              {emailError && (
                <span className="error-text">{emailError}</span>
              )}
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
                  type="password"
                  id="password"
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setEmailError("");
                  }}
                />
              </div>
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
  );
}
