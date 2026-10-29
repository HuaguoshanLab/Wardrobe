import { entityId } from '../../../lib/id'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { getConfigs, seasons, type Plan } from './api'

export function InventoryContext({
  draft,
  change,
  onNotice,
  onError,
  initiallyCopy = false,
}: {
  initiallyCopy?: boolean
  draft: Plan
  change: (value: Plan) => void
  onNotice: (value: string) => void
  onError: (value: string) => void
}) {
  const [copyFrom, setCopyFrom] = useState('')
  const configs = useQuery({ queryKey: ['inventory-configs'], queryFn: getConfigs })
  return (
    <div className="inventory-editor-extras">
      <details className="inventory-disclosure">
        <summary>生活背景与收纳偏好（选填）</summary>
        <div className="inventory-form">
          <label>
            所在城市
            <input
              maxLength={80}
              value={draft.city}
              onChange={(e) => change({ ...draft, city: e.target.value })}
            />
          </label>
          <label>
            自定季节时段
            <input
              maxLength={120}
              value={draft.period}
              onChange={(e) => change({ ...draft, period: e.target.value })}
              placeholder="例如：每年 4–6 月"
            />
          </label>
          <label>
            收纳偏好与备注
            <textarea
              maxLength={1000}
              value={draft.notes}
              onChange={(e) => change({ ...draft, notes: e.target.value })}
            />
          </label>
          <p className="muted">用于记录你的背景，不会按城市自动生成数量或覆盖目标。</p>
        </div>
      </details>
      <details className="inventory-disclosure inventory-copy" open={initiallyCopy}>
        <summary>复制其他季节的需求</summary>
        <p className="muted">复制会追加新需求草稿，保留本季已有配置。</p>
        <label>
          复制来源
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">选择季节</option>
            {configs.data
              ?.filter((p) => p.season !== draft.season)
              .map((p) => (
                <option key={p.season} value={p.season}>
                  {seasons[p.season]}季 · {p.rows.length} 条
                </option>
              ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={!copyFrom || !configs.data}
          onClick={() => {
            const source = configs.data?.find((p) => p.season === copyFrom)
            if (!source?.rows.length) {
              onNotice('来源季节还没有需求。')
              return
            }
            if (draft.rows.length + source.rows.length > 100) {
              onError('复制后超过 100 条，请先减少需求行。')
              return
            }
            change({
              ...draft,
              rows: [...draft.rows, ...source.rows.map((r) => ({ ...r, id: entityId() }))],
            })
            onNotice(`已追加 ${source.rows.length} 条草稿，尚未保存。`)
          }}
        >
          追加到本季草稿
        </Button>
        {configs.error && (
          <p role="alert">
            {configs.error.message}
            <Button onClick={() => void configs.refetch()}>重试季节配置</Button>
          </p>
        )}
      </details>
    </div>
  )
}
