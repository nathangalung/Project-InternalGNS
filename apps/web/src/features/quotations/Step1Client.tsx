import type { ContactRow } from "@/types/api"
import { qe } from "./wizard-styles"

const searchWrapper = "relative w-full"
const searchIcon = "pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-dark-500"
const searchInput =
  "w-full rounded-lg bg-dark-200 py-[14px] pl-[52px] pr-6 text-sm font-normal text-dark-900 outline-none transition-colors duration-150 placeholder:text-dark-500 placeholder:opacity-70 focus:bg-dark-300"
const clientItemBase =
  "flex w-full cursor-pointer items-center gap-6 rounded-lg border p-5 text-left transition-[border-color,background] duration-200"
const clientItemIdle = "border-[rgba(203,213,225,0.15)] bg-white"
const clientItemSelected = "border-[rgba(124,58,237,0.4)] bg-dark-100"
const radioBase =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200"
const radioIdle = "border-dark-300"
const radioSelected = "border-primary-700"
const radioDot = "h-3 w-3 rounded-full bg-primary-700"

export interface Client {
  id: string
  name: string
  narahubung: string
  country: string
  initials: string
  phone?: string
  email?: string
  nomorTKU?: string
  referenceNumber?: string
  npwp?: string
  lokasi?: string
}

interface Step1ClientProps {
  search: string
  setSearch: (s: string) => void
  filteredClients: Client[]
  selectedClient: string
  setSelectedClient: (id: string) => void
  setShowClientAdd: (show: boolean) => void
  contacts?: ContactRow[]
  selectedContactId?: number | undefined
  setSelectedContactId?: (id: number | undefined) => void
}

export default function Step1Client({
  search,
  setSearch,
  filteredClients,
  selectedClient,
  setSelectedClient,
  setShowClientAdd,
  contacts = [],
  selectedContactId,
  setSelectedContactId,
}: Step1ClientProps) {
  return (
    <div className={qe.stepContent}>
      <div className={qe.sectionHeader}>
        <div>
          <h2 className={qe.sectionTitle}>Pilih Klien Strategis</h2>
          <p className={qe.sectionDesc}>Tentukan mitra bisnis untuk penawaran harga ini.</p>
        </div>
        <button
          type="button"
          className={`${qe.addBtn} w-[210px] justify-center`}
          onClick={() => setShowClientAdd(true)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Tambah Klien Baru
        </button>
      </div>

      <div className={searchWrapper}>
        <svg
          className={searchIcon}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className={searchInput}
          type="text"
          placeholder="Cari nama perusahaan atau nama narahubung..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3">
        {filteredClients.map((client) => {
          const isSelected = client.id === selectedClient
          return (
            <button
              key={client.id}
              className={`${clientItemBase} ${isSelected ? clientItemSelected : clientItemIdle}`}
              onClick={() => setSelectedClient(client.id)}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-[rgba(203,213,225,0.15)] bg-white">
                <span className="text-sm font-bold text-primary-700">{client.initials}</span>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-base font-bold leading-6 tracking-[-0.4px] text-dark-900">
                  {client.name} - {client.narahubung}
                </span>
                <span className="flex items-center gap-1 text-[0.6875rem] font-normal leading-4 text-dark-600">
                  <svg width="9" height="12" viewBox="0 0 9 12" fill="none">
                    <path
                      d="M4.5 0C2.015 0 0 2.015 0 4.5C0 7.875 4.5 12 4.5 12C4.5 12 9 7.875 9 4.5C9 2.015 6.985 0 4.5 0ZM4.5 6C3.672 6 3 5.328 3 4.5C3 3.672 3.672 3 4.5 3C5.328 3 6 3.672 6 4.5C6 5.328 5.328 6 4.5 6Z"
                      fill="currentColor"
                    />
                  </svg>
                  {client.country}
                </span>
              </div>
              <div className={`${radioBase} ${isSelected ? radioSelected : radioIdle}`}>
                {isSelected && <div className={radioDot} />}
              </div>
            </button>
          )
        })}
      </div>

      {selectedClient && contacts.length > 0 && setSelectedContactId && (
        <div className="mt-6">
          <h3 className="m-0 mb-3 text-sm font-bold text-[#191C1E]">Pilih Narahubung</h3>
          <div className="flex flex-col gap-2">
            {contacts.map((c) => {
              const isSelected = c.id === selectedContactId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedContactId?.(c.id)}
                  className={`flex w-full items-center gap-3 rounded-md border-[1.5px] px-4 py-3 text-left ${
                    isSelected
                      ? "border-primary-700 bg-[#F5F0FF]"
                      : "border-transparent bg-[#F2F4F6]"
                  }`}
                >
                  <div className={`${radioBase} ${isSelected ? radioSelected : radioIdle}`}>
                    {isSelected && <div className={radioDot} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#191C1E]">
                      {c.name}
                      {c.title && (
                        <span className="ml-2 text-xs font-normal text-dark-500">{c.title}</span>
                      )}
                    </div>
                    {(c.phone || c.email) && (
                      <div className="mt-0.5 text-xs text-dark-500">
                        {[c.phone, c.email].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
