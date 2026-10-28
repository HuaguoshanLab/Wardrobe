import { useParams } from 'react-router'
import { useOutfits, OutfitLookbook } from '../outfits'

export function HomePage() {
  const { sessionId } = useParams()
  const outfits = useOutfits(sessionId)
  const prepare = sessionId ? `/outfits/${sessionId}/prepare` : '/outfits/prepare'
  return (
    <div className="today-page">
      <header className="today-heading">
        <div>
          <span className="eyebrow">衣序 · 每日灵感</span>
          <h1>今日穿搭</h1>
        </div>
      </header>
      <OutfitLookbook controller={outfits} preparePath={prepare} />
    </div>
  )
}
