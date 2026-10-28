import { Button } from '../../components/ui/button'
import type { OutfitController } from './use-outfits'
import { OutfitStatus } from './task-status'
import { OutfitChat } from './chat'
import './adjustments.css'

export function OutfitsPanel({ controller: c }: { controller: OutfitController }) {
  const categories: Record<string, string> = {
    top: '上装',
    bottom: '下装',
    dress: '连衣裙',
    outerwear: '外套',
    shoes: '鞋',
    bag: '包',
    hat: '帽子',
    scarf: '围巾',
    belt: '腰带',
    jewelry: '首饰',
    other_accessory: '配饰',
  }
  const s = c.session
  const revision = s?.revisions.find((item) => item.id === s.selected_revision_id)
  if (!s || !revision)
    return (
      <>
        <OutfitStatus controller={c} compact />
        <p>请先选用一套搭配。</p>
      </>
    )
  return (
    <section className="adjust-panel" aria-label="调整当前搭配">
      <p className="muted">锁定想保留的衣服，或只换其中一件。</p>
      <OutfitStatus controller={c} compact />
      {!!s.invalid_garment_ids.length && (
        <p className="error">部分单品当前不可用，请解锁、恢复或替换。历史快照仍保留。</p>
      )}
      <div className="adjust-items">
        {revision.items.map((item) => {
          const name = String(item.attributes.name || categories[item.slot] || item.slot)
          const locked = !!item.garment_id && s.locked_garment_ids.includes(item.garment_id)
          return (
            <article key={item.item_id} data-item-id={item.item_id} className="adjust-item">
              {item.source === 'wardrobe' ? (
                <>
                  {item.image_url && <img src={item.image_url} alt={name} />}
                  <div className="adjust-item-info">
                    <strong>{name}</strong>
                    {item.garment_id && s.invalid_garment_ids.includes(item.garment_id) && (
                      <span className="error">当前不可用</span>
                    )}
                    <label className="lock-control">
                      <input
                        type="checkbox"
                        checked={locked}
                        disabled={c.busy || !item.garment_id}
                        onChange={(e) =>
                          c.patch({
                            locked_garment_ids: e.target.checked
                              ? [...s.locked_garment_ids, item.garment_id!]
                              : s.locked_garment_ids.filter((id) => id !== item.garment_id),
                          })
                        }
                      />
                      锁定此单品
                    </label>
                  </div>
                </>
              ) : (
                <div className="adjust-item-info">
                  <strong>未拥有建议</strong>
                  <p>{item.description}</p>
                </div>
              )}
              <Button
                variant="outline"
                disabled={c.busy || locked}
                onClick={() => c.adjust('replace_items', [item.item_id], '')}
              >
                只替换此项
              </Button>
            </article>
          )
        })}
      </div>
      <Button disabled={c.busy} onClick={() => c.adjust('rebuild_unlocked', [], '')}>
        重搭未锁定部分
      </Button>
      <OutfitChat key={s.id} sessionId={s.id} controller={c} />
      <details className="message-history">
        <summary>已发送消息（{s.messages.length}）</summary>
        {s.messages.map((m) => (
          <p key={m.id}>
            <strong>{m.role === 'user' ? '你' : '助手'}：</strong>
            {m.content}
          </p>
        ))}
      </details>
    </section>
  )
}
