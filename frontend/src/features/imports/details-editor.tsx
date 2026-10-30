import { useId } from 'react'
import type { ImportDetails } from './details-schema'

export function ImportDetailsEditor({
  value,
  onChange,
  errors,
}: {
  errors: Record<string, string>
  value: ImportDetails
  onChange: (changes: Partial<ImportDetails>) => void
}) {
  const hintId = useId()
  const select = (
    key: 'source' | 'condition' | 'fit' | 'storage',
    label: string,
    options: Record<string, string>,
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value[key] ?? ''}
        onChange={(e) => onChange({ [key]: e.target.value || null })}
      >
        {Object.entries(options).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <>
      <section>
        <h2>分类与当前状况</h2>
        <p className="muted">如实填写后可用于四季盘点；不确定就保留未知。</p>
        <label>
          子类
          <input
            aria-label="子类"
            aria-describedby={`${hintId}-subtype`}
            value={value.subtype_name ?? ''}
            maxLength={40}
            placeholder="例如：T恤、衬衫、运动鞋"
            onChange={(e) => onChange({ subtype_name: e.target.value || null })}
          />
          <small id={`${hintId}-subtype`} className="muted">
            按当前品类匹配同名子类；新名称在确认入库后创建。
          </small>
        </label>
        <div className="editor-select-grid">
          {select('condition', '衣物状况', {
            unknown: '未知 / 待核对',
            good: '完好',
            worn: '轻微磨损',
            needs_repair: '需要维修',
            damaged: '严重损坏',
          })}
          {select('fit', '合身情况', {
            unknown: '未知 / 待核对',
            fits: '合身',
            unfit: '不合身',
            not_applicable: '不适用',
          })}
        </div>
      </section>
      <section>
        <h2>获得与收纳资料</h2>
        <p className="muted">全部选填，不会根据照片推断，也不会自动创建维修或退出记录。</p>
        <div className="editor-select-grid">
          {select('source', '获得来源', {
            '': '未知 / 未填写',
            purchased: '购买',
            gift: '获赠',
            other: '其他',
          })}
          <label>
            获得日期
            <input
              aria-label="获得日期"
              aria-describedby={errors.acquired_on ? `${hintId}-date-error` : undefined}
              aria-invalid={!!errors.acquired_on}
              type="date"
              value={value.acquired_on ?? ''}
              onChange={(e) => onChange({ acquired_on: e.target.value || null })}
            />
            {errors.acquired_on && (
              <small id={`${hintId}-date-error`} role="alert" className="error">
                {errors.acquired_on}
              </small>
            )}
          </label>
          <label>
            购入金额（元）
            <input
              aria-label="购入金额（元）"
              aria-describedby={errors.price ? `${hintId}-price-error` : undefined}
              aria-invalid={!!errors.price}
              inputMode="decimal"
              value={value.price ?? ''}
              placeholder="未知留空，免费填 0"
              onChange={(e) => onChange({ price: e.target.value || null })}
            />
            {errors.price && (
              <small id={`${hintId}-price-error`} role="alert" className="error">
                {errors.price}
              </small>
            )}
          </label>
        </div>
        {select('storage', '收纳状态', { daily: '日常使用', stored: '已收纳' })}
        <label>
          收纳位置
          <input
            value={value.location ?? ''}
            maxLength={120}
            placeholder="例如：卧室衣柜第二层"
            onChange={(e) => onChange({ location: e.target.value || null })}
          />
        </label>
        <label>
          档案备注
          <textarea
            value={value.notes}
            maxLength={2000}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </label>
      </section>
    </>
  )
}
