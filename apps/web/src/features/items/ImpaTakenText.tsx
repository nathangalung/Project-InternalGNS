import EntityLink from "@/components/shared/EntityLink"
import type { ItemImpaHolder } from "@/types/api"

type ImpaTakenTextProps = {
  holder: ItemImpaHolder
  // False inside an unsaved document, which a link would leave
  linked: boolean
}

// Names the code's holder.
export default function ImpaTakenText({ holder, linked }: ImpaTakenTextProps) {
  const name = `“${holder.name}”`
  return (
    <>
      Kode IMPA ini sudah dipakai{" "}
      {linked ? (
        <EntityLink kind="product" id={holder.id} tone="name">
          {name}
        </EntityLink>
      ) : (
        <strong>{name}</strong>
      )}
      .
    </>
  )
}
