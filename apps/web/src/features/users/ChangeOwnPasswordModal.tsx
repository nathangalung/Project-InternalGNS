import { type FormEvent, useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { formErrors } from "@/features/users/form-errors"
import { useChangeOwnPassword, useEndOwnSession } from "@/features/users/hooks"
import PasswordChecklist from "@/features/users/PasswordChecklist"
import PasswordInput from "@/features/users/PasswordInput"
import { passwordIsValid } from "@/features/users/password"
import { ApiError } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"

type ChangeOwnPasswordModalProps = {
  onClose: () => void
}

const FIELDS = ["currentPassword", "newPassword"] as const

type Field = (typeof FIELDS)[number]

const errorText = "text-[12px] text-[#B91C1C]"

// Self-service password change.
//
// Open to every role. A success ends every session on the server, this one
// included, so the reader is signed out and sent to the login page.
export default function ChangeOwnPasswordModal({ onClose }: ChangeOwnPasswordModalProps) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [banner, setBanner] = useState<string | null>(null)

  const formId = useId()
  const currentId = useId()
  const nextId = useId()
  const confirmId = useId()
  const checklistId = useId()

  const change = useChangeOwnPassword()
  const endSession = useEndOwnSession()
  const saving = change.isPending

  const mismatch = confirm.length > 0 && confirm !== next
  const canSubmit = current.length > 0 && passwordIsValid(next) && confirm === next && !saving

  const close = () => {
    if (!saving) onClose()
  }

  const clearError = (field: Field) => {
    setErrors((e) => ({ ...e, [field]: undefined }))
    setBanner(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next })
      endSession(
        "Kata sandi berhasil diubah. Silakan masuk kembali dengan kata sandi baru.",
        "success",
      )
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 401)) {
        // Session is gone either way.
        endSession(errorMessage(err, "Sesi Anda berakhir. Silakan masuk kembali."), "error")
        return
      }
      if (err instanceof ApiError && err.status === 422) {
        const split = formErrors(err, FIELDS, "Gagal mengubah kata sandi.")
        setErrors(split.fields)
        setBanner(split.banner)
        return
      }
      toast.error(errorMessage(err, "Gagal mengubah kata sandi."))
    }
  }

  return (
    <Modal
      title="Ubah Kata Sandi"
      onClose={close}
      className="w-[520px]"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-x-4 gap-y-3">
          {banner && (
            <p role="alert" className={`mr-auto ${errorText}`}>
              {banner}
            </p>
          )}
          <div className="flex gap-4 max-sm:w-full">
            <button
              type="button"
              className={`${ui.modalCancel} whitespace-nowrap max-sm:flex-1 max-sm:px-4`}
              onClick={close}
              disabled={saving}
            >
              Batal
            </button>
            <button
              type="submit"
              form={formId}
              className={`${ui.modalSubmit} whitespace-nowrap max-sm:flex-1 max-sm:px-4`}
              disabled={!canSubmit}
            >
              {saving ? "Menyimpan…" : "Ubah Kata Sandi"}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className={ui.modalSection} noValidate>
        <p className="text-sm text-[#4A4455]">
          Setelah kata sandi diubah, semua sesi Anda berakhir dan Anda perlu masuk kembali.
        </p>

        <div className={ui.field}>
          <label htmlFor={currentId} className={ui.fieldLabel}>
            Kata Sandi Saat Ini <span className="text-primary-700">*</span>
          </label>
          <PasswordInput
            id={currentId}
            value={current}
            onChange={(v) => {
              setCurrent(v)
              clearError("currentPassword")
            }}
            autoComplete="current-password"
            className={ui.fieldInput}
            invalid={!!errors.currentPassword}
            describedBy={errors.currentPassword ? `${currentId}-err` : undefined}
          />
          {errors.currentPassword && (
            <p id={`${currentId}-err`} className={errorText}>
              {errors.currentPassword}
            </p>
          )}
        </div>

        <div className={ui.field}>
          <label htmlFor={nextId} className={ui.fieldLabel}>
            Kata Sandi Baru <span className="text-primary-700">*</span>
          </label>
          <PasswordInput
            id={nextId}
            value={next}
            onChange={(v) => {
              setNext(v)
              clearError("newPassword")
            }}
            autoComplete="new-password"
            className={ui.fieldInput}
            invalid={!!errors.newPassword}
            describedBy={errors.newPassword ? `${nextId}-err ${checklistId}` : checklistId}
          />
          {errors.newPassword && (
            <p id={`${nextId}-err`} className={errorText}>
              {errors.newPassword}
            </p>
          )}
          <PasswordChecklist id={checklistId} value={next} alwaysShow />
        </div>

        <div className={ui.field}>
          <label htmlFor={confirmId} className={ui.fieldLabel}>
            Ulangi Kata Sandi Baru <span className="text-primary-700">*</span>
          </label>
          <PasswordInput
            id={confirmId}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            className={ui.fieldInput}
            invalid={mismatch}
            describedBy={mismatch ? `${confirmId}-err` : undefined}
          />
          {mismatch && (
            <p id={`${confirmId}-err`} className={errorText}>
              Konfirmasi kata sandi tidak sama.
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}
