import { useState } from 'react'
import { Shirt } from 'lucide-react'
import type { Revision } from '../outfits'

export function RecordImage({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  return src && !failed ? (
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span className="record-image-empty">
      <Shirt size={24} aria-hidden="true" />
      <span>{name}</span>
      <small>图片不可用</small>
    </span>
  )
}
export function RecordPreview({ revision }: { revision: Revision }) {
  const items = revision.items.filter((item) => item.source === 'wardrobe')
  const suggestions = revision.items.filter((item) => item.source === 'suggestion')
  return (
    <div className="record-preview-stage">
      <div className="record-composition" data-count={Math.min(items.length, 4)}>
        {items.map((item) => (
          <div key={item.item_id}>
            <RecordImage src={item.image_url} name={String(item.attributes.name || '单品')} />
          </div>
        ))}
      </div>
      {!items.length && <p className="muted">暂无衣橱单品图片</p>}
      {!!suggestions.length && (
        <span className="record-suggestion-label">含 {suggestions.length} 项未拥有建议</span>
      )}
      {revision.provider_mode === 'fake' && <span className="record-simulation">模拟搭配</span>}
    </div>
  )
}
