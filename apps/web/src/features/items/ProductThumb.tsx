import EntityLogo from "@/components/shared/EntityLogo"
import { useItemImage } from "@/features/items/hooks"

type ProductThumbProps = {
  id: number
  name: string
  imageObjectKey?: string
}

// Catalog list thumbnail.
// The product photo, or its initials while loading or without one.
export default function ProductThumb({ id, name, imageObjectKey }: ProductThumbProps) {
  const src = useItemImage(id, imageObjectKey)
  return <EntityLogo name={name} src={src || undefined} />
}
