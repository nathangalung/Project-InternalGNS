import { useId, useState } from "react"
import FieldError from "@/components/shared/FieldError"
import { contactEmailError, contactUpdateBody } from "@/features/clients/helpers"
import { useUpdateContact } from "@/features/clients/hooks"
import { ui } from "@/lib/ui"
import { contactReachError, optionalEmailError, optionalPhoneError } from "@/lib/validation"
import type { ContactRow } from "@/types/api"

const inputCls =
  "w-full rounded-md border border-[rgba(203,213,225,0.6)] bg-white px-3 py-2 text-sm text-[#191C1E] outline-none focus:border-primary-700"

type ContactCompletionProps = {
  clientId: number
  contact: ContactRow
}

// Fills a contact's missing channel.
//
// A picked contact with neither email nor phone is completed here, on the
// spot, instead of sending the user to the client page.
export default function ContactCompletion({ clientId, contact }: ContactCompletionProps) {
  const fid = useId()
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [taken, setTaken] = useState("")
  const update = useUpdateContact()

  const emailError = taken || optionalEmailError(email)
  const phoneError = optionalPhoneError(phone)
  const canSave = !emailError && !phoneError && !contactReachError(email, phone)

  function save() {
    if (!canSave) return
    update.mutate(
      {
        companyId: clientId,
        contactId: contact.id,
        input: contactUpdateBody(
          { name: contact.name, phone, email, title: contact.title ?? "" },
          contact.countryCode,
        ),
      },
      { onError: (err) => setTaken(contactEmailError(err) ?? "") },
    )
  }

  return (
    <div className="mt-3 rounded-md border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.06)] p-4">
      <p className="m-0 mb-3 text-[13px] font-semibold text-[#B45309]">
        {contact.name} belum punya email atau nomor HP. Lengkapi salah satu dulu.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
        <div>
          <label
            htmlFor={`${fid}-email`}
            className="mb-1 block text-xs font-semibold text-[#4A4455]"
          >
            Email
          </label>
          <input
            id={`${fid}-email`}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setTaken("")
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${fid}-email-error` : undefined}
            placeholder="email@perusahaan.com"
            className={inputCls}
          />
          <FieldError id={`${fid}-email-error`} message={emailError} />
        </div>
        <div>
          <label
            htmlFor={`${fid}-phone`}
            className="mb-1 block text-xs font-semibold text-[#4A4455]"
          >
            Nomor HP
          </label>
          <input
            id={`${fid}-phone`}
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneError ? true : undefined}
            aria-describedby={phoneError ? `${fid}-phone-error` : undefined}
            placeholder="81234567890"
            className={inputCls}
          />
          <FieldError id={`${fid}-phone-error`} message={phoneError} />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!canSave || update.isPending}
          className={`${ui.modalSubmit} px-4 py-2 text-[13px]`}
        >
          {update.isPending ? "Menyimpan..." : "Simpan Narahubung"}
        </button>
      </div>
    </div>
  )
}
