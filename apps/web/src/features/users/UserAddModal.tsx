import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { formErrors, isInlineFormError } from "@/features/users/form-errors"
import { useCreateUser } from "@/features/users/hooks"
import PasswordChecklist from "@/features/users/PasswordChecklist"
import PasswordInput from "@/features/users/PasswordInput"
import { passwordIsValid } from "@/features/users/password"
import { ui } from "@/lib/ui"
import type { Role } from "@/types/api"

type UserAddModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type RoleCard = {
  value: Role
  label: string
}

const ROLE_CARDS: RoleCard[] = [
  { value: "superadmin", label: "Super Admin" },
  { value: "finance", label: "Finance" },
  { value: "operational", label: "Operasional" },
]

// Least privilege by default.
const DEFAULT_ROLE: Role = "operational"

const FIELDS = ["name", "email", "password", "role"] as const

type Field = (typeof FIELDS)[number]

const errorText = "text-[12px] text-[#B91C1C]"

function isValidEmail(s: string): boolean {
  return s.includes("@") && s.split("@").length === 2 && s.split("@")[1].includes(".")
}

export default function UserAddModal({ open, onOpenChange }: UserAddModalProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<Role>(DEFAULT_ROLE)
  const [isActive, setIsActive] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({})

  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const checklistId = useId()
  const roleHeadingId = useId()
  const statusId = useId()
  const statusHintId = useId()

  const createUser = useCreateUser()
  const isSaving = createUser.isPending

  if (!open) return null

  const isNameFilled = name.trim().length > 0
  const isEmailValid = email.trim().length > 0 && isValidEmail(email)
  const isPasswordValid = passwordIsValid(password)
  const emailError =
    serverErrors.email ??
    (email.trim().length > 0 && !isValidEmail(email) ? "Format email tidak valid." : undefined)
  const canSubmit = isNameFilled && isEmailValid && isPasswordValid

  const clearServer = (field: Field) => {
    setServerErrors((p) => ({ ...p, [field]: undefined }))
    setSubmitError(null)
  }

  const reset = () => {
    setName("")
    setEmail("")
    setPassword("")
    setRole(DEFAULT_ROLE)
    setIsActive(true)
    setSubmitError(null)
    setServerErrors({})
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
      // Other failures are toasted by the hook.
      if (!isInlineFormError(err)) return
      const split = formErrors(err, FIELDS, "Gagal menyimpan pengguna.")
      setServerErrors(split.fields)
      setSubmitError(split.banner)
    }
  }

  return (
    <Modal
      title="Tambah Pengguna"
      onClose={handleCancel}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-x-4 gap-y-3">
          {submitError && (
            <p role="alert" className={`mr-auto ${errorText}`}>
              {submitError}
            </p>
          )}
          <div className="flex gap-4 max-sm:w-full">
            <button
              type="button"
              className={`${ui.modalCancel} whitespace-nowrap max-sm:flex-1 max-sm:px-4`}
              onClick={handleCancel}
              disabled={isSaving}
            >
              Batal
            </button>
            <button
              type="button"
              className={`${ui.modalSubmit} whitespace-nowrap max-sm:flex-1 max-sm:px-4`}
              onClick={handleSubmit}
              disabled={!canSubmit || isSaving}
            >
              {isSaving ? "Menyimpan..." : "Simpan Akun"}
            </button>
          </div>
        </div>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Identitas Pengguna</div>
        <div className={ui.row2}>
          <div className={ui.field}>
            <label htmlFor={nameId} className={ui.fieldLabel}>
              Nama Lengkap <span className="text-primary-700">*</span>
            </label>
            <input
              id={nameId}
              className={ui.fieldInput}
              type="text"
              placeholder="Contoh: Budi Santoso"
              autoComplete="off"
              value={name}
              aria-invalid={!!serverErrors.name || undefined}
              aria-describedby={serverErrors.name ? `${nameId}-err` : undefined}
              onChange={(e) => {
                setName(e.target.value)
                clearServer("name")
              }}
            />
            {serverErrors.name && (
              <span id={`${nameId}-err`} className={errorText}>
                {serverErrors.name}
              </span>
            )}
          </div>
          <div className={ui.field}>
            <label htmlFor={emailId} className={ui.fieldLabel}>
              Alamat Email <span className="text-primary-700">*</span>
            </label>
            <input
              id={emailId}
              className={ui.fieldInput}
              type="email"
              placeholder="email@ptglobal.com"
              autoComplete="off"
              value={email}
              aria-invalid={!!emailError || undefined}
              aria-describedby={emailError ? `${emailId}-err` : undefined}
              onChange={(e) => {
                setEmail(e.target.value)
                clearServer("email")
              }}
            />
            {emailError && (
              <span id={`${emailId}-err`} className={errorText}>
                {emailError}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Kata Sandi</div>
        <div className={ui.field}>
          <label htmlFor={passwordId} className={ui.fieldLabel}>
            Kata Sandi <span className="text-primary-700">*</span>
          </label>
          <PasswordInput
            id={passwordId}
            value={password}
            onChange={(v) => {
              setPassword(v)
              clearServer("password")
            }}
            autoComplete="new-password"
            className={ui.fieldInput}
            invalid={!!serverErrors.password}
            describedBy={serverErrors.password ? `${passwordId}-err ${checklistId}` : checklistId}
          />
          {serverErrors.password && (
            <span id={`${passwordId}-err`} className={errorText}>
              {serverErrors.password}
            </span>
          )}
          <PasswordChecklist id={checklistId} value={password} />
        </div>
      </div>

      <div className={ui.modalSection}>
        <div id={roleHeadingId} className={ui.modalSectionHeading}>
          Peran
        </div>
        <div className={ui.field}>
          <fieldset
            aria-labelledby={roleHeadingId}
            className="m-0 min-w-0 border-0 p-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3"
          >
            {ROLE_CARDS.map((card) => {
              const selected = role === card.value
              return (
                <button
                  key={card.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setRole(card.value)
                    clearServer("role")
                  }}
                  className={`flex items-center justify-center rounded-md px-3 py-[14px] text-[13px] tracking-[-0.2px] transition-all duration-150 ${ui.focusRing} ${
                    selected
                      ? "bg-[#EADDFF] font-bold text-primary-800 shadow-[0_0_0_1.5px_rgba(99,14,212,0.4)]"
                      : "bg-[#F2F4F6] font-medium text-[#191C1E]"
                  }`}
                >
                  {card.label}
                </button>
              )
            })}
          </fieldset>
          {serverErrors.role && <span className={errorText}>{serverErrors.role}</span>}
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className="flex items-center justify-between gap-3 rounded-md border border-[rgba(204,195,216,0.1)] bg-[#F2F4F6] px-[14px] py-2.5">
          <div className="flex-1">
            <div id={statusId} className="text-[13px] font-bold leading-[18px] text-[#191C1E]">
              Status Aktif
            </div>
            <div
              id={statusHintId}
              className="mt-0.5 text-[12px] font-normal leading-4 text-[#4A4455]"
            >
              Pengguna dapat langsung login dan mengakses sistem.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsActive((a) => !a)}
            role="switch"
            aria-checked={isActive}
            aria-labelledby={statusId}
            aria-describedby={statusHintId}
            className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${ui.focusRing} ${
              isActive ? "bg-primary-700" : "bg-dark-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 motion-reduce:transition-none ${
                isActive ? "left-5" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </Modal>
  )
}
