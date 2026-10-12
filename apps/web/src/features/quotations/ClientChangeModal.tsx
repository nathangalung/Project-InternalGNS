import { useEffect, useState } from "react"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import Step1Client from "./Step1Client"
import { useClientPicker } from "./useClientPicker"
import { clientChangeReady, defaultContact } from "./wizardClient"

type ClientChangeModalProps = {
  // The document's client and narahubung now
  clientId: number
  contactId?: number
  // What changes and what stays
  note: string
  // A PO may keep its client and take another narahubung
  allowSame?: boolean
  // Saves; resolves to a refusal message, or null once saved
  onSave: (clientId: number, contactId: number | undefined) => Promise<string | null>
  onClose: () => void
}

// Ganti Klien dialog.
//
// The wizard's paged picker, then the new client's narahubung, completed on
// the spot when it has no email or phone. The caller saves; a refusal stays
// in the dialog with the choice kept.
export default function ClientChangeModal({
  clientId,
  contactId,
  note,
  allowSame = false,
  onSave,
  onClose,
}: ClientChangeModalProps) {
  const [selectedClient, setSelectedClient] = useState(String(clientId))
  const [selectedContactId, setSelectedContactId] = useState<number | undefined>(contactId)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const picker = useClientPicker(selectedClient)
  const { contacts, contactsPending, currentClient } = picker

  // A new client starts on its own contact.
  // Only once its contacts are in, so the stored pick is not lost meanwhile.
  const clientContactId = currentClient?.contactId
  useEffect(() => {
    if (contactsPending) return
    setSelectedContactId((cur) => defaultContact(contacts, cur, clientContactId))
  }, [contacts, contactsPending, clientContactId])

  const ready = clientChangeReady({
    from: { clientId, contactId },
    clientId: Number(selectedClient) || undefined,
    contactId: selectedContactId,
    contacts,
    contactsPending,
    allowSame,
  })

  async function save() {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    const refused = await onSave(Number(selectedClient), selectedContactId)
    setSaving(false)
    if (refused) setError(refused)
  }

  function pickClient(id: string) {
    setError(null)
    setSelectedClient(id)
  }

  return (
    <Modal
      title="Ganti Klien"
      onClose={onClose}
      className="max-w-[min(760px,94vw)]!"
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={() => void save()}
            disabled={!ready || saving}
          >
            {saving ? "Menyimpan..." : "Simpan Klien"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <p className="m-0 text-sm leading-6 text-[#4A4455]">{note}</p>
        {error && (
          <p role="alert" className="m-0 text-sm text-[#B91C1C]">
            {error}
          </p>
        )}
        <Step1Client
          heading={false}
          search={picker.search}
          setSearch={picker.changeSearch}
          filteredClients={picker.filteredClients}
          picker={picker.picker}
          selectedClient={selectedClient}
          setSelectedClient={pickClient}
          clientsFailure={picker.clientsFailure}
          contacts={contacts}
          selectedContactId={selectedContactId}
          setSelectedContactId={(id) => {
            setError(null)
            setSelectedContactId(id)
          }}
        />
        {!contactsPending && contacts.length === 0 && (
          <p className="m-0 text-[13px] text-[#B45309]">
            Klien ini belum punya narahubung aktif. Klien tetap dapat dipilih, lalu tambahkan
            narahubungnya di halaman klien.
          </p>
        )}
      </div>
    </Modal>
  )
}
