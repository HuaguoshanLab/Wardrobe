import { Navigate, useParams } from 'react-router'

// Keep existing bookmarks usable without maintaining a second editing interface.
export function OutfitEditPage() {
  const { sessionId } = useParams()
  return <Navigate to={`/outfits/${sessionId}?adjust=1`} replace />
}
