import './members.css'
import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { GarmentImage } from '../image'
import { seasons, type Count, type Inventory } from './api'
export type Bucket = 'confirmed' | 'pending' | 'excluded'

export function InventoryMembers({
  data,
  count,
  initialBucket,
  returnTo,
}: {
  data: Inventory
  count: Count
  initialBucket: Bucket
  returnTo: string
}) {
  const [bucket, setBucket] = useState<'confirmed' | 'pending' | 'excluded'>(initialBucket)
  const [limit, setLimit] = useState(20)
  const members = count.members.filter((m) => m.bucket === bucket)
  const lookup = new Map(data.garments.map((g) => [g.id, g]))
  return (
    <div className="inventory-members">
      <p className="muted">打开单品可修改季节、子类、场合或状况。保存后返回盘点，会重新核算。</p>
      <div className="inventory-member-tabs" role="group" aria-label="单品统计分组">
        {(['confirmed', 'pending', 'excluded'] as const).map((key) => (
          <Button
            variant="outline"
            key={key}
            aria-pressed={bucket === key}
            onClick={() => {
              setBucket(key)
              setLimit(20)
            }}
          >
            {{ confirmed: '已确认', pending: '待核对', excluded: '不计入' }[key]}{' '}
            {count.members.filter((m) => m.bucket === key).length}
          </Button>
        ))}
      </div>
      {!members.length && <p>这一组暂无单品。</p>}
      {members.slice(0, limit).map((member) => {
        const garment = lookup.get(member.garment_id)!
        return (
          <Link
            className="inventory-member"
            to={`/wardrobe/${garment.id}`}
            state={{ inventoryReturn: `${returnTo}&focus=${count.row_id}&group=${bucket}` }}
            key={garment.id}
          >
            <GarmentImage src={garment.image_url} alt={garment.name} retry={false} />
            <div>
              <strong>{garment.name}</strong>
              <p>{member.reasons.join('；') || '已确认符合本行需求'}</p>
              {member.covered_by.length > 1 && (
                <small>
                  同时覆盖：
                  {member.covered_by.map((c) => `${seasons[c.season]}季·${c.name}`).join('、')}
                </small>
              )}
            </div>
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        )
      })}
      {members.length > limit && (
        <Button variant="outline" onClick={() => setLimit(limit + 20)}>
          显示更多单品（已显示 {limit}/{members.length}）
        </Button>
      )}
    </div>
  )
}
