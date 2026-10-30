import type { RefObject } from 'react'
import { Plus, Shirt, X } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { RecordImage } from '../preview'
import type { Picked } from './state'

export function ManualSelection({
  items,
  busy,
  ready,
  buttonRef,
  onOpen,
  onRemove,
  onRefresh,
}: {
  items: Picked[]
  busy: boolean
  ready: boolean
  buttonRef: RefObject<HTMLButtonElement | null>
  onOpen: () => void
  onRemove: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <section className="manual-composition" aria-labelledby="manual-selection-title">
      <div className="manual-section-heading">
        <div>
          <h2 id="manual-selection-title">这套搭配</h2>
          <p className="muted">
            {items.length ? `已选 ${items.length} 件 · 最多 20 件` : '从衣橱选出你的组合'}
          </p>
        </div>
        <Button ref={buttonRef} variant="outline" disabled={busy || !ready} onClick={onOpen}>
          <Plus size={18} aria-hidden="true" />
          选择衣服
        </Button>
      </div>
      {!items.length && ready && (
        <div className="manual-empty">
          <Shirt size={44} strokeWidth={1.3} aria-hidden="true" />
          <h3>今天想怎样搭？</h3>
          <p>
            衣服、鞋和配饰都可以选。
            <br />
            也可以只记录一件。
          </p>
        </div>
      )}
      <div className="manual-selected">
        {items.map((item, index) => (
          <article key={item.id} className="manual-selected-item" data-issue={!!item.issue}>
            <div className="manual-garment-image">
              <RecordImage src={item.image_url} name={item.name} />
            </div>
            <div className="manual-garment-meta">
              <span className="manual-item-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{item.name}</h3>
              <span className={item.issue ? 'error' : 'muted'}>
                {item.issue ||
                  (item.availability === 'available' ? '可穿' : '暂不可用 · 仅可补记实际穿着')}
              </span>
              <Button
                variant="outline"
                className="manual-text-action"
                disabled={busy}
                aria-label={`移除：${item.name}`}
                onClick={() => onRemove(item.id)}
              >
                <X size={16} aria-hidden="true" />
                移除
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!!items.length && (
        <Button
          variant="outline"
          className="manual-text-action"
          disabled={busy}
          onClick={onRefresh}
        >
          重新核对所选衣服
        </Button>
      )}
    </section>
  )
}
