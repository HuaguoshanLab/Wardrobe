import { useQuery } from '@tanstack/react-query'
import { Sheet } from '../../components/ui/sheet'
import { getTaxonomy } from '../wardrobe'
import type { Revision } from '../outfits'
import { RecordImage } from './preview'

const labels = {
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
export function Snapshot({ revision }: { revision: Revision }) {
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const owned = revision.items.filter((item) => item.source === 'wardrobe')
  const suggestions = revision.items.filter((item) => item.source === 'suggestion')
  const temperature = revision.weather_snapshot.temperature_c
  const source = revision.weather_snapshot.source
  const display = (field: string, value: unknown) => {
    const values = Array.isArray(value) ? value : value != null && value !== '' ? [value] : []
    return values.length
      ? values.map((v) => taxonomy.data?.fields[field]?.[String(v)] ?? String(v)).join('、')
      : '未标注'
  }
  return (
    <>
      <div className="record-detail-stage">
        <div className="record-composition" data-count={Math.min(owned.length, 4)}>
          {owned.map((item) => {
            const name = String(item.attributes.name || '单品')
            return (
              <Sheet
                key={item.item_id}
                title={name}
                trigger={
                  <button className="snapshot-piece" aria-label={`查看当时单品：${name}`}>
                    <RecordImage src={item.image_url} name={name} />
                    <span>{name}</span>
                  </button>
                }
              >
                <div className="snapshot-attributes">
                  <RecordImage src={item.image_url} name={name} />
                  <p className="muted">这是保存搭配时的图片与属性。</p>
                  {taxonomy.error && (
                    <p role="alert">
                      属性名称读取失败。
                      <button onClick={() => void taxonomy.refetch()}>重试</button>
                    </p>
                  )}
                  <dl>
                    {Object.entries(labels).map(([field, label]) => (
                      <div key={field}>
                        <dt>{label}</dt>
                        <dd>{display(field, item.attributes[field])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Sheet>
            )
          })}
        </div>
        {!owned.length && <p className="muted">这套搭配没有衣橱单品。</p>}
      </div>
      <div className="record-weather">
        <span>当时天气</span>
        <strong>
          {typeof temperature === 'number' ? `${Math.round(temperature)}℃` : '温度未知'} ·{' '}
          {String(revision.weather_snapshot.condition || '天气未知')}
        </strong>
        <small>
          {source === 'manual' ? '手动填写' : source === 'qweather' ? '和风天气' : '来源未标注'}
        </small>
      </div>
      {!!suggestions.length && (
        <section className="record-suggestions">
          <h2>未拥有的搭配建议</h2>
          {suggestions.map((item) => (
            <p key={item.item_id}>{item.description || '未填写建议说明'}</p>
          ))}
        </section>
      )}
      {!!revision.unmet_requirements.length && (
        <section className="record-unmet">
          <h2>这套搭配的未满足项</h2>
          <ul>
            {revision.unmet_requirements.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      <details className="record-explanation">
        <summary>搭配说明</summary>
        <p>{revision.reason || '没有额外说明。'}</p>
      </details>
    </>
  )
}
