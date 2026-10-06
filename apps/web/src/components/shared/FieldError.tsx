// Inline field message.
export default function FieldError({
  id,
  message,
}: {
  id: string
  message: string | null | undefined
}) {
  if (!message) return null
  return (
    <div id={id} className="mt-1.5 text-xs text-[#DC2626]">
      {message}
    </div>
  )
}
