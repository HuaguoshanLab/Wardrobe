import { ChevronRight, History, ListChecks, Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import type { Garment } from './api'
import './detail-actions.css'

export function DetailActions({
  item,
  returnState,
  disabled,
  onEdit,
}: {
  item: Pick<Garment, 'id' | 'is_demo' | 'ownership'>
  returnState: unknown
  disabled: boolean
  onEdit: () => void
}) {
  return (
    <div className="detail-actions">
      <Button disabled={disabled} onClick={onEdit}>
        <Pencil size={18} aria-hidden="true" />
        编辑单品信息
      </Button>
      <nav className="detail-management" aria-label="单品管理">
        <Link
          to={`/wardrobe/${item.id}/lifecycle`}
          state={returnState}
          aria-label="生命周期 · 获得、收纳与整理"
        >
          <History size={22} aria-hidden="true" />
          <span>
            <strong>单品生命周期</strong>
            <small>状况与合身 · 获得资料 · 收纳记录</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
        {!item.is_demo && item.ownership === 'owned' && (
          <Link
            to={`/wardrobe/organization/garments/${item.id}`}
            aria-label="观察 / 保留 / 处理这件衣服"
          >
            <ListChecks size={22} aria-hidden="true" />
            <span>
              <strong>观察与处理</strong>
              <small>保留、维修或退出衣橱</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </div>
  )
}
