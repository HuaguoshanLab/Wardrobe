import { Link } from 'react-router'
import { GarmentImage } from '../image'
import type { Garment } from '../api'
import { status } from './state'

export function CarePicker({
  items,
  selected,
  busy,
  onToggle,
  returnTo,
}: {
  items: Garment[]
  selected: Garment[]
  busy: boolean
  onToggle: (g: Garment) => void
  returnTo: string
}) {
  return (
    <div className="care-items">
      {items.map((g) => {
        const checked = selected.some((s) => s.id === g.id)
        const name = g.name || '未命名单品'
        return (
          <article className="care-item" data-selected={checked} key={g.id}>
            <label className="care-item-select" data-selected={checked}>
              <input
                type="checkbox"
                checked={checked}
                disabled={busy || (!checked && selected.length >= 20)}
                onChange={() => onToggle(g)}
                aria-label={`选择：${name}`}
              />
              <GarmentImage className="care-image" src={g.image_url} alt="" retry={false} />
              <span>
                <strong>{name}</strong>
                <small className="care-status">
                  {status(g)}
                  {checked && <span className="care-selected-label"> · 已选</span>}
                </small>
                <small>位置：{g.lifecycle.location || '未填写'}</small>
              </span>
            </label>
            <Link
              className="text-link care-detail"
              to={`/wardrobe/${g.id}/lifecycle`}
              state={{ careReturn: returnTo }}
            >
              查看状态与资料
            </Link>
          </article>
        )
      })}
    </div>
  )
}
