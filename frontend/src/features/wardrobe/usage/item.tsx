import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router'
import { GarmentImage } from '../image'
import type { UsageItem } from './api'

const enteredDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))

export function UsageCard({
  item,
  returnTo,
  category,
}: {
  item: UsageItem
  returnTo: string
  category?: string
}) {
  const name = item.name || category || '未命名单品'
  return (
    <article className="usage-card">
      <Link
        className="usage-item-main"
        to={`/wardrobe/${item.garment_id}`}
        state={{ usageReturn: returnTo }}
        aria-label={`查看单品：${name}`}
      >
        <GarmentImage src={item.image_url ?? ''} alt="" className="usage-image" retry={false} />
        <div>
          <span className="usage-category">{category || '品类未知'}</span>
          <h3>{name}</h3>
          <span className="usage-availability" data-unavailable={item.availability !== 'available'}>
            {item.availability === 'available' ? '可穿' : '暂不可穿'}
          </span>
        </div>
        <ArrowUpRight size={18} className="usage-detail-icon" aria-hidden="true" />
      </Link>
      <div className="usage-item-bottom">
        <div className="usage-item-records">
          <strong>{item.wear_days > 0 ? `记录穿着 ${item.wear_days} 天` : '期间无记录'}</strong>
          <dl>
            <div>
              <dt>最近记录</dt>
              <dd>{item.last_worn_on ?? '暂无'}</dd>
            </div>
            <div>
              <dt>入库日期</dt>
              <dd>{enteredDate(item.created_at)}</dd>
            </div>
          </dl>
        </div>
        <div className="usage-item-actions">
          {item.availability === 'available' ? (
            <Link
              className="button button-outline"
              to={`/outfits/prepare?anchor=${item.garment_id}`}
              state={{ usageReturn: returnTo }}
            >
              围绕这件搭配
            </Link>
          ) : (
            <Link
              className="button button-outline"
              to={`/wardrobe/${item.garment_id}/lifecycle`}
              state={{ usageReturn: returnTo }}
            >
              查看可用状态
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}
