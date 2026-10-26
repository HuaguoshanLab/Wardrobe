import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '../../components/ui/button'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation } from '../../lib/use-operation'
import { sessionSchema, type Revision } from '../outfits'
import { getRevision, today } from './api'
import { getTaxonomy } from '../wardrobe'
import '../outfits/outfits.css'

const attributeLabels: Record<string, string> = {
  category: '品类',
  color_codes: '颜色',
  seasons: '季节',
  occasion_codes: '场合',
  style_codes: '风格',
  material: '材质',
  thickness: '厚度',
  warmth: '保暖程度',
  tag_names: '标签',
  notes: '备注',
}
export function Snapshot({ revision: r }: { revision: Revision }) {
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: getTaxonomy })
  const display = (field: string, value: unknown) => {
    const values = Array.isArray(value) ? value : value ? [value] : []
    return values.length
      ? values.map((v) => taxonomy.data?.fields[field]?.[String(v)] ?? String(v)).join('、')
      : '未知 / 未标注'
  }
  return (
    <article className="outfit-card">
      <h2>{r.provider_mode === 'fake' ? 'Fake 模拟搭配' : '搭配快照'}</h2>
      <small>{new Date(r.created_at).toLocaleString('zh-CN')}</small>
      <div className="outfit-items">
        {r.items.map((item) => (
          <div className="outfit-item" key={item.item_id}>
            {item.image_url && (
              <img src={item.image_url} alt={String(item.attributes.name ?? '单品快照')} />
            )}
            <strong>
              {item.source === 'suggestion' ? '未拥有建议' : String(item.attributes.name ?? '单品')}
            </strong>
            {item.description && <p>{item.description}</p>}
            {item.source === 'wardrobe' && (
              <details>
                <summary>当时属性</summary>
                <dl>
                  {Object.entries(attributeLabels).map(([field, label]) => (
                    <div key={field}>
                      <dt>{label}</dt>
                      <dd>{display(field, item.attributes[field])}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </div>
        ))}
      </div>
      <p>{r.reason}</p>
      <p>
        天气：{String(r.weather_snapshot.temperature_c ?? '未知')}℃ ·{' '}
        {String(r.weather_snapshot.condition ?? '未知')}（
        {r.weather_snapshot.source === 'manual' ? '手动' : '和风'}）
      </p>
      {!!r.unmet_requirements.length && (
        <ul>
          {r.unmet_requirements.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
    </article>
  )
}

export function RevisionPage() {
  const { revisionId = '' } = useParams()
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => getRevision(revisionId),
  })
  const op = useOperation('collections', (value, path) => {
    if (path === '/outfit-sessions') navigate(`/outfits/${sessionSchema.parse(value).id}`)
  })
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>搭配详情</h1>
          <p>图片和属性保留生成时状态。复用会检查当前衣服，不自动生成。</p>
        </div>
      </div>
      <Link to="/collections">返回历史与收藏</Link>
      {query.isPending && <p>正在读取快照…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      <OperationNotice operation={op} />
      {query.data && (
        <>
          <Snapshot revision={query.data} />
          <section className="panel attribute-form">
            <label>
              收藏名称
              <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </label>
            <Button
              disabled={op.busy}
              onClick={() => op.send('/favorites', 'POST', { revision_id: revisionId, name })}
            >
              收藏此版本
            </Button>
            <label>
              实际穿着日期
              <input
                type="date"
                max={today()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              穿着备注
              <textarea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <Button
              disabled={op.busy || !date}
              onClick={() =>
                op.send('/wear-records', 'POST', { revision_id: revisionId, worn_on: date, notes })
              }
            >
              记录穿着
            </Button>
            <Button
              variant="outline"
              disabled={op.busy}
              onClick={() => op.send('/outfit-sessions', 'POST', { base_revision_id: revisionId })}
            >
              复用为新会话
            </Button>
            <p>收藏不会自动记录穿着；同一天可以记录不同搭配。</p>
          </section>
        </>
      )}
    </>
  )
}
