import { createFileRoute, useParams } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import RouteErrorFallback from "@/components/shared/RouteErrorFallback"
import ClientDetail from "@/features/clients/ClientDetail"
import { useClient } from "@/features/clients/hooks"
import { isMissing } from "@/lib/errors"

export const Route = createFileRoute("/_authed/clients/$id/")({
  component: ClientDetailRoute,
})

function ClientDetailRoute() {
  const { id } = useParams({ from: "/_authed/clients/$id/" })
  const numericId = Number(id)
  const { data, isLoading, error, refetch } = useClient(numericId)

  if (!data) {
    if (isLoading) return <LoadingState label="Memuat data klien…" />
    if (error && !isMissing(error)) {
      return <RouteErrorFallback error={error} reset={() => void refetch()} />
    }
    return (
      <NotFoundState
        title="Klien tidak ditemukan"
        size="page"
        backTo={{ to: "/clients", label: "Kembali ke Daftar Klien" }}
      />
    )
  }

  // Keyed so a different client remounts with fresh form state, while a
  // background refetch of the same client keeps in-progress edits.
  return <ClientDetail key={data.id} client={data} />
}
