import { useState } from "react"
import Modal from "@/components/shared/Modal"
import { useClientContacts } from "@/features/clients/hooks"
import { useUpdateQuotationContact } from "@/features/quotations/hooks"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"

type ContactModalProps = {
  quotationId: number
  companyId: number
  // Preselected when still active
  contactId?: number
  onClose: () => void
}

// Ganti Narahubung picker.
//
// The editor is closed once a quotation leaves draft, but the PO gate
// refuses a deactivated narahubung, so an accepted quotation re-picks here.
// Only active contacts are listed.
export default function ContactModal({
  quotationId,
  companyId,
  contactId,
  onClose,
}: ContactModalProps) {
  const { data: contacts, isPending } = useClientContacts(companyId)
  const [picked, setPicked] = useState<number | undefined>(contactId)
  const update = useUpdateQuotationContact()
  const active = contacts ?? []
  const choice = active.some((c) => c.id === picked) ? picked : undefined

  function submit() {
    if (choice === undefined || update.isPending) return
    update.mutate(
      { id: quotationId, contactId: choice },
      {
        onSuccess: () => {
          toast.success("Narahubung quotation diperbarui.")
          onClose()
        },
      },
    )
  }

  return (
    <Modal
      title="Ganti Narahubung"
      onClose={onClose}
      className="max-w-[min(520px,92vw)]!"
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={submit}
            disabled={choice === undefined || update.isPending}
          >
            {update.isPending ? "Menyimpan…" : "Simpan"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        {isPending ? (
          <p className="text-sm text-[#4A4455]">Memuat narahubung…</p>
        ) : active.length === 0 ? (
          <p className="text-sm leading-6 text-[#4A4455]">
            Klien ini belum memiliki narahubung aktif. Tambahkan narahubung di data klien terlebih
            dahulu.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {active.map((c) => {
              const selected = c.id === choice
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPicked(c.id)}
                  aria-pressed={selected}
                  className={`flex w-full flex-col rounded-md border-[1.5px] px-4 py-3 text-left ${ui.focusRing} ${
                    selected ? "border-primary-700 bg-[#F5F0FF]" : "border-transparent bg-[#F2F4F6]"
                  }`}
                >
                  <span className="text-sm font-semibold text-[#191C1E]">
                    {c.name}
                    {c.title && (
                      <span className="ml-2 text-xs font-normal text-dark-500">{c.title}</span>
                    )}
                  </span>
                  {(c.phone || c.email) && (
                    <span className="mt-0.5 text-xs text-dark-500">
                      {[c.phone, c.email].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
