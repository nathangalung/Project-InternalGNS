import { ui } from "@/lib/ui"

interface FileCardProps {
  fileName?: string
  onUpload: () => void
  onDownload: () => void
}

export default function FileCard({ fileName, onUpload, onDownload }: FileCardProps) {
  const hasFile = Boolean(fileName)

  return (
    <div>
      <h2 className="mb-3 text-base font-bold leading-6 tracking-[-0.025em] text-dark-900">
        Lampiran Invoice
      </h2>
      <div className="flex items-center gap-4 rounded-lg border border-[rgba(204,195,216,0.2)] bg-white px-6 py-5">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
            hasFile ? "bg-[rgba(99,14,212,0.12)]" : "bg-dark-100"
          }`}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={hasFile ? "#630ED4" : "#94A3B8"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-sm font-bold ${
              hasFile ? "text-[#111827]" : "italic text-dark-400"
            }`}
          >
            {hasFile ? fileName : "Belum ada bukti pembayaran yang diunggah"}
          </div>
        </div>
        <div className="flex gap-2.5">
          <button type="button" onClick={onUpload} className={`${ui.btnOutline} min-w-[120px]`}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {hasFile ? "Ganti Berkas" : "Unggah Berkas"}
          </button>
          {hasFile && (
            <button type="button" onClick={onDownload} className={`${ui.btnPrimary} min-w-[120px]`}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="#fff"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Unduh Berkas
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
