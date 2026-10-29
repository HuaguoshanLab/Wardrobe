import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronRight,
  Heart,
  MapPin,
  Shirt,
  Wrench,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import type { Garment } from './api'
import { GarmentImage } from './image'
import { labels, type LifecycleAction, type Subtype } from './lifecycle-api'

export function LifecycleOverview({
  item,
  subtypes,
  wear,
  busy,
  onAction,
}: {
  item: Garment
  subtypes: Subtype[] | undefined
  wear?: { wear_days: number; last_worn_on: string | null }
  busy: boolean
  onAction: (action: LifecycleAction) => void
}) {
  const p = item.lifecycle
  const retired = item.ownership === 'retired'
  const available = labels.availability[item.availability]
  const reason = p.unavailable_reason ? labels.unavailable_reason[p.unavailable_reason] : ''
  const subtype = subtypes?.find((s) => s.id === item.subtype_id)?.name
  const actions = [
    {
      action: 'availability',
      title: '可穿状态',
      value: reason || available,
      hint: '可穿 / 待洗 / 暂不可用',
      icon: Shirt,
    },
    {
      action: 'storage',
      title: '收纳位置',
      value: p.location || labels.storage[p.storage],
      hint: p.location ? labels.storage[p.storage] : '记住它放在哪里',
      icon: MapPin,
    },
    {
      action: 'condition',
      title: '状况与合身',
      value: p.condition === 'unknown' ? '状况待补充' : labels.condition[p.condition],
      hint: p.fit === 'unknown' ? '合身情况待补充' : labels.fit[p.fit],
      icon: Check,
    },
    {
      action: 'decision',
      title: '整理决定',
      value: labels.decision[p.decision],
      hint: p.decision_reason || '保留，或留待处理',
      icon: Heart,
    },
  ] as const
  return (
    <>
      <section className="lifecycle-identity" aria-label="单品当前状态">
        <div className="lifecycle-heading">
          <GarmentImage
            key={item.image_url}
            src={item.image_url}
            alt={item.name || '我的单品'}
            className="lifecycle-photo"
          />
          <div className="lifecycle-heading-copy">
            <span className="eyebrow">{retired ? '已归档的单品' : '陪伴你的每一件'}</span>
            <h2>{item.name || '我的单品'}</h2>
            <div className="lifecycle-badges">
              <span
                className={`lifecycle-badge ${retired || item.availability === 'unavailable' ? 'is-muted' : ''}`}
              >
                {retired ? '已退出衣橱' : reason ? `${available} · ${reason}` : available}
              </span>
              {!retired && <span>{labels.storage[p.storage]}</span>}
            </div>
          </div>
        </div>
        <div className="lifecycle-wear">
          <span>实际穿着</span>
          {wear ? (
            <div>
              <strong>
                {wear.wear_days ? (
                  <>
                    <b>{wear.wear_days}</b> 天已记录
                  </>
                ) : (
                  '暂无穿着记录'
                )}
              </strong>
              <small>
                {wear.last_worn_on ? `最近穿着 ${wear.last_worn_on}` : '无记录不代表没有穿过'}
              </small>
            </div>
          ) : (
            <span className="muted">穿着记录尚未读取</span>
          )}
        </div>
      </section>
      {!retired && (
        <section className="lifecycle-section" aria-labelledby="lifecycle-manage-title">
          <div className="lifecycle-section-heading">
            <h2 id="lifecycle-manage-title">日常管理</h2>
            <span>按需要更新</span>
          </div>
          <div className="lifecycle-action-grid">
            {actions.map(({ action, title, value, hint, icon: Icon }) => (
              <Button
                key={action}
                variant="outline"
                className="lifecycle-action-card"
                disabled={busy}
                aria-label={`${title}：${value}`}
                onClick={() => onAction(action)}
              >
                <span className="lifecycle-action-top">
                  <Icon size={19} aria-hidden="true" />
                  <span>{title}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
                <strong>{value}</strong>
                <small>{hint}</small>
              </Button>
            ))}
          </div>
          <div className="lifecycle-repair">
            <Wrench size={18} aria-hidden="true" />
            <div>
              <strong>{p.unavailable_reason === 'repair' ? '正在维修中' : '修好后，继续穿'}</strong>
              <small>
                {p.unavailable_reason === 'repair'
                  ? '完成后确认衣物状况和可穿状态'
                  : '需要修补时，记录一次维修'}
              </small>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                onAction(p.unavailable_reason === 'repair' ? 'repair_complete' : 'repair_start')
              }
            >
              {p.unavailable_reason === 'repair' ? '完成维修' : '开始维修'}
            </Button>
          </div>
        </section>
      )}
      <section className="panel lifecycle-profile" aria-labelledby="lifecycle-profile-title">
        <div className="lifecycle-section-heading">
          <h2 id="lifecycle-profile-title">单品档案</h2>
          <Button variant="outline" disabled={busy} onClick={() => onAction('profile')}>
            补充获得资料
          </Button>
        </div>
        <dl className="lifecycle-facts">
          <div>
            <dt>获得日期</dt>
            <dd>{p.acquired_on || '待补充'}</dd>
          </div>
          <div>
            <dt>购入金额</dt>
            <dd>{p.price === null ? '待补充' : `¥${p.price}`}</dd>
          </div>
          <div>
            <dt>获得来源</dt>
            <dd>{p.source ? labels.source[p.source] : '待补充'}</dd>
          </div>
          <div>
            <dt>衣物子类</dt>
            <dd>{subtype || (item.subtype_id ? '子类信息待读取' : '未分类')}</dd>
          </div>
        </dl>
        {retired && (
          <details className="lifecycle-retained">
            <summary>查看保留的状态资料</summary>
            <dl className="lifecycle-facts">
              <div>
                <dt>收纳位置</dt>
                <dd>
                  {p.location || '未填写'} · {labels.storage[p.storage]}
                </dd>
              </div>
              <div>
                <dt>状况与合身</dt>
                <dd>
                  {labels.condition[p.condition]} · {labels.fit[p.fit]}
                </dd>
              </div>
              <div>
                <dt>可用状态</dt>
                <dd>
                  {available}
                  {reason && ` · ${reason}`}（已退出，不参与搭配）
                </dd>
              </div>
              <div>
                <dt>整理决定</dt>
                <dd>
                  {labels.decision[p.decision]}
                  {p.decision_reason && ` · ${p.decision_reason}`}
                </dd>
              </div>
            </dl>
          </details>
        )}
        {p.notes && <p className="lifecycle-profile-note">{p.notes}</p>}
        <p className="lifecycle-recorded">
          {new Date(item.created_at).toLocaleDateString('zh-CN')} 录入衣橱 · 资料可随时补充
        </p>
      </section>
    </>
  )
}

export function LifecycleArchive({
  item,
  busy,
  canRestore,
  onAction,
}: {
  item: Garment
  busy: boolean
  canRestore: boolean
  onAction: (action: LifecycleAction) => void
}) {
  const retired = item.ownership === 'retired'
  return (
    <section className="lifecycle-archive" aria-label="衣橱归档">
      <Archive size={20} aria-hidden="true" />
      <div>
        <h2>{retired ? '已留存为档案' : '不再拥有这件衣服？'}</h2>
        <p>
          {retired
            ? `${item.lifecycle.exited_on ?? '日期未记录'} · ${item.lifecycle.exit_reason ? labels.exit_reason[item.lifecycle.exit_reason] : '去向未记录'}。照片与穿搭记录已保留。`
            : '转赠、出售或丢弃后，留下它的记录。'}
        </p>
      </div>
      <Button
        variant="outline"
        className={retired ? '' : 'lifecycle-exit'}
        disabled={busy || (retired && !canRestore)}
        onClick={() => onAction(retired ? 'restore' : 'retire')}
      >
        {retired ? '撤销退出' : '退出衣橱'}
        <ArrowUpRight size={16} aria-hidden="true" />
      </Button>
    </section>
  )
}
