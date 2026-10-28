import type { Revision } from './api'

export function OutfitExplanation({ revision }: { revision: Revision }) {
  // Preserve the complete saved explanation; only split known section markers.
  const [facts, advice] = revision.reason.split(/审美建议（主观尝试，不是单品属性或匹配结论）：/)
  const paragraphs = facts.split(/(?=第\d+件（)|(?=未采集)/).filter(Boolean)
  const weather = revision.weather_snapshot
  const source =
    weather.source === 'manual'
      ? '手动填写'
      : weather.source === 'qweather'
        ? '和风天气'
        : '来源未标注'
  return (
    <div className="outfit-explanation">
      {!!revision.unmet_requirements.length && (
        <section className="explanation-warning">
          <h3>穿着前留意</h3>
          <ul>
            {revision.unmet_requirements.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>搭配依据</h3>
        <p className="muted">依据这套搭配保存时的真实属性，未知信息不作推断。</p>
        <details className="explanation-facts">
          <summary>查看单品属性与完整说明</summary>
          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </details>
      </section>
      {advice && (
        <section>
          <h3>审美建议</h3>
          <p>{advice}</p>
          <small className="muted">主观搭配建议，不代表单品属性或匹配结论。</small>
        </section>
      )}
      <section>
        <h3>生成时天气</h3>
        <p>
          {formatTemperature(weather.temperature_c)} · {String(weather.condition ?? '天气未知')}
        </p>
        <small className="muted">
          {source} ·{' '}
          {new Date(revision.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}{' '}
          保存的快照，不代表当前天气
        </small>
      </section>
    </div>
  )
}
export function formatTemperature(value: unknown) {
  return typeof value === 'number' ? `${Math.round(value)}℃` : '温度未知'
}
