import { useState } from 'react'
import { Button } from '../../components/ui/button'
import type { OutfitController } from './use-outfits'
import { OutfitStatus } from './task-status'
import { OutfitChat } from './chat'
import './adjustments.css'

export function OutfitsPanel({
  controller: c,
  onAccepted,
}: {
  controller: OutfitController
  onAccepted?: () => void
}) {
  const [mode, setMode] = useState('pieces')
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
      <div className="adjust-modes" role="group" aria-label="调整方式">
        <button aria-pressed={mode === 'pieces'} onClick={() => setMode('pieces')}>
          单品调整
        </button>
        <button aria-pressed={mode === 'chat'} onClick={() => setMode('chat')}>
          描述要求
        </button>
      </div>
      <p className="muted">
        {mode === 'pieces'
          ? '锁定想保留的单品；只换一件时，其他单品都会保留。'
          : '告诉我你想改变什么，已锁定的单品会保留。'}
      </p>
      <OutfitStatus controller={c} compact />
      {!!s.invalid_garment_ids.length && (
        <p className="error">部分单品当前不可用，请解锁、恢复或替换。历史快照仍保留。</p>
      )}
      <div hidden={mode !== 'pieces'}>
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
                  onClick={async () => {
                    if (await c.adjust('replace_items', [item.item_id], '')) onAccepted?.()
                  }}
                >
                  只换这件
                </Button>
              </article>
            )
          })}
        </div>
        <p className="adjust-summary">
          已锁定 {s.locked_garment_ids.length} 件 · 重搭只改变未锁定部分
        </p>
        <Button
          className="adjust-rebuild"
          disabled={c.busy}
          onClick={async () => {
            if (await c.adjust('rebuild_unlocked', [], '')) onAccepted?.()
          }}
        >
          重搭未锁定部分
        </Button>
      </div>
      <div hidden={mode !== 'chat'}>
        <OutfitChat key={s.id} sessionId={s.id} controller={c} onAccepted={onAccepted} />
        <details className="message-history">
          <summary>已发送消息（{s.messages.length}）</summary>
          {s.messages.map((m) => (
            <p key={m.id}>
              <strong>{m.role === 'user' ? '你' : '助手'}：</strong>
              {m.content}
            </p>
          ))}
        </details>
      </div>
    </section>
  )
}
