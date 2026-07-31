import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import type { CompletenessIssue } from "./helpers"

interface CompletenessModalProps {
  issues: CompletenessIssue[]
  onClose: () => void
  onNavigateEntity?: (scope: "Klien" | "Vendor", id: number) => void
}

export default function CompletenessModal({
  issues,
  onClose,
  onNavigateEntity,
}: CompletenessModalProps) {
  return (
    <Modal
      title="Data Belum Lengkap"
      onClose={onClose}
      footer={
        <button type="button" className={ui.modalSubmit} onClick={onClose}>
          Mengerti
        </button>
      }
    >
      <p className="m-0 mb-4 text-[13px] leading-[1.5] text-[#4A4455]">
        Sebelum mengubah status menjadi <strong className="text-[#9333EA]">Dalam Progres</strong>,
        data berikut harus dilengkapi terlebih dahulu. Klik kartu untuk membuka halaman edit.
      </p>

      {issues.map((issue, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => onNavigateEntity?.(issue.scope, issue.id)}
          className={`block w-full rounded-md border border-accent-200 bg-accent-100 px-3.5 py-3 text-left transition ${
            idx < issues.length - 1 ? "mb-2.5" : ""
          } ${
            onNavigateEntity
              ? "cursor-pointer hover:border-warning hover:bg-accent-200"
              : "cursor-default"
          }`}
        >
          <div className="mb-1 flex items-center justify-between text-[13px] font-bold text-accent-900">
            <span>
              {issue.scope}: {issue.name}
            </span>
            {onNavigateEntity && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </div>
          <ul className="m-0 list-disc pl-5 text-xs leading-[1.6] text-accent-900">
            {issue.missing.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </button>
      ))}
    </Modal>
  )
}
