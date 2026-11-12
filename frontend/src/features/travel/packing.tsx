import { useState } from 'react'
import { CheckCheck, Luggage } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { GarmentImage } from '../wardrobe'
import type { Travel } from './api'

export function TravelPacking({
  plan,
  busy,
  onAction,
}: {
  plan: Travel
  busy: boolean
  onAction: (action: string, body: object) => Promise<boolean>
}) {
  const [pending, setPending] = useState<{ id: string; value: boolean } | null>(null)
  const [onlyRemaining, setOnlyRemaining] = useState(false)
  const packed = plan.packing.filter((i) => i.packed).length
  const remaining = plan.packing.length - packed
  const items = plan.packing.filter(
    (i) => !onlyRemaining || !i.packed || pending?.id === i.garment_id,
  )
  return (
    <section
      className="panel travel-packing"
      id="travel-packing"
      tabIndex={-1}
      aria-labelledby="packing-title"
    >
      <div className="travel-section-heading">
        <Luggage size={24} aria-hidden="true" />
        <div>
          <span className="eyebrow">PACKING LIST</span>
          <h2 id="packing-title">行李清单 · {plan.packing.length} 件</h2>
        </div>
      </div>
      <p role="status" aria-live="polite">
        已收拾 {packed} / {plan.packing.length} ·{' '}
        {remaining ? `还差 ${remaining} 件` : '全部收拾好了'}
      </p>
      <progress aria-label="行李收拾进度" max={plan.packing.length || 1} value={packed} />
      <div className="travel-packing-toolbar">
        <p className="muted">期望 {plan.revision?.request.target_count} 件 · 同一件衣服只计一次</p>
        <Button
          variant="outline"
          aria-pressed={onlyRemaining}
          onClick={() => setOnlyRemaining((v) => !v)}
        >
          只看待收拾
        </Button>
      </div>
      {!items.length && (
        <p className="travel-empty">
          <CheckCheck aria-hidden="true" size={24} />
          全部收拾好了。取消筛选可查看全部。
        </p>
      )}
      <div className="travel-packing-grid">
        {items.map((entry) => (
          <label className="travel-pack-row" data-packed={entry.packed} key={entry.garment_id}>
            <input
              type="checkbox"
              checked={pending?.id === entry.garment_id ? pending.value : entry.packed}
              disabled={busy || !!pending}
              onChange={async () => {
                setPending({ id: entry.garment_id, value: !entry.packed })
                try {
                  await onAction('packing', {
                    expected_version: plan.version,
                    garment_id: entry.garment_id,
                    packed: !entry.packed,
                  })
                } finally {
                  setPending(null)
                }
              }}
            />
            {entry.item.image_url && (
              <GarmentImage src={entry.item.image_url} alt="" retry={false} />
            )}
            <span>
              <strong>{String(entry.item.attributes.name || '未命名单品')}</strong>
              {pending?.id === entry.garment_id ? (
                <small role="status">正在保存…</small>
              ) : (
                <small>{entry.packed ? '已收拾' : entry.added ? '新增待收拾' : '待收拾'}</small>
              )}
              <small>
                第{' '}
                {entry.dates
                  .map((date) => (plan.revision?.days.findIndex((d) => d.date === date) ?? -1) + 1)
                  .join('、')}{' '}
                天使用 · 共 {entry.dates.length} 天
              </small>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}
