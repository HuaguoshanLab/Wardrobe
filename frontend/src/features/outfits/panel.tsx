import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import type { OutfitController } from './use-outfits'
import './outfits.css'
import { OutfitChat } from './chat'

export function OutfitsPanel({ controller: c }: { controller: OutfitController }) {
  const statusNames: Record<string, string> = {
    queued: '排队中',
    running: '处理中',
    cancel_requested: '正在取消',
    succeeded: '已完成',
    failed: '失败',
    interrupted: '已中断',
    cancelled: '已取消',
  }
  const categories: Record<string, string> = {
    top: '上装',
    bottom: '下装',
    dress: '连衣裙',
    outerwear: '外套',
    shoes: '鞋',
    bag: '包',
    hat: '帽子',
    scarf: '围巾',
    belt: '腰带',
    jewelry: '首饰',
    other_accessory: '配饰',
  }
  const s = c.session
  return (
    <section className="panel outfit-panel">
      <div className="actions">
        <h2>搭配方案</h2>
        <Button variant="outline" disabled={c.busy} onClick={c.newSession}>
          新建搭配会话
        </Button>
      </div>
      <p>生成和调整会保存完整版本；刷新与重新打开只恢复现有结果。</p>
      {c.error && (
        <p role="alert" className="error">
          {c.error.message}
        </p>
      )}
      {c.pending && (
        <div className="notice">
          <p>有一项操作尚未确认结果，刷新不会自动重发。</p>
          <Button disabled={c.submitting} onClick={c.resend}>
            重发同一搭配操作
          </Button>
          <Button variant="outline" disabled={c.submitting} onClick={c.discard}>
            放弃待发操作并刷新
          </Button>
        </div>
      )}
      {c.notice && <p role="status">{c.notice}</p>}
      {c.job && (
        <div className="notice">
          <p>任务状态：{statusNames[c.job.status]}</p>
          {c.job.error && <p role="alert">{c.job.error.message}</p>}
          {c.job.result?.outcome === 'no_match' && (
            <p>{c.job.result.unmet_requirements.join('；')}</p>
          )}
          {c.job.result?.question && <p>{c.job.result.question}</p>}
          {c.active && (
            <Button disabled={c.cancel.isPending} onClick={() => c.cancel.mutate()}>
              请求取消
            </Button>
          )}
          {['failed', 'interrupted'].includes(c.job.status) && (
            <>
              <p>请先核对条件；重试可能再次调用模型并计费。</p>
              <Button disabled={c.busy} onClick={c.retry}>
                显式重试搭配任务
              </Button>
            </>
          )}
        </div>
      )}
      {!s && <p>尚无搭配会话。填写今天的条件后，点击“生成搭配”。</p>}
      {s && (
        <>
          <Link to={`/outfits/${s.id}`}>打开此会话</Link>
          {!!s.invalid_garment_ids.length && (
            <p className="error">
              部分旧结果中的衣服已不可用或删除。历史快照保留；重新使用前请解锁、恢复或替换。
            </p>
          )}
          <div className="outfit-grid">
            {s.revisions.map((revision) => (
              <article className="outfit-card" key={revision.id}>
                <h3>
                  {revision.id === s.selected_revision_id ? '已选方案' : '候选方案'} ·{' '}
                  {revision.provider_mode === 'fake' ? 'Fake 模拟' : '千问'}
                </h3>
                <small>
                  {new Date(revision.created_at).toLocaleString('zh-CN')} · 天气来源：
                  {revision.weather_snapshot.source === 'manual' ? '手动填写' : '和风天气'}
                </small>
                <p>
                  温度 {String(revision.weather_snapshot.temperature_c ?? '未知')}℃ ·{' '}
                  {String(revision.weather_snapshot.condition ?? '')}
                </p>
                <div className="outfit-items">
                  {revision.items.map((item) => (
                    <div key={item.item_id} data-item-id={item.item_id} className="outfit-item">
                      {item.source === 'wardrobe' ? (
                        <>
                          {item.image_url && (
                            <img
                              src={item.image_url}
                              alt={String(
                                item.attributes.name ?? categories[item.slot] ?? item.slot,
                              )}
                            />
                          )}
                          <strong>
                            {String(item.attributes.name ?? categories[item.slot] ?? item.slot)}
                          </strong>
                          {item.garment_id && s.invalid_garment_ids.includes(item.garment_id) && (
                            <span className="error">当前已失效</span>
                          )}
                          {revision.id === s.selected_revision_id && (
                            <label>
                              <input
                                type="checkbox"
                                checked={s.locked_garment_ids.includes(item.garment_id!)}
                                disabled={c.busy}
                                onChange={(e) =>
                                  c.patch({
                                    locked_garment_ids: e.target.checked
                                      ? [...s.locked_garment_ids, item.garment_id!]
                                      : s.locked_garment_ids.filter((id) => id !== item.garment_id),
                                  })
                                }
                              />
                              锁定此单品
                            </label>
                          )}
                        </>
                      ) : (
                        <>
                          <strong>未拥有建议</strong>
                          <p>{item.description}</p>
                        </>
                      )}
                      {revision.id === s.selected_revision_id && (
                        <Button
                          variant="outline"
                          disabled={
                            c.busy ||
                            (!!item.garment_id && s.locked_garment_ids.includes(item.garment_id))
                          }
                          onClick={() => c.adjust('replace_items', [item.item_id], '')}
                        >
                          只替换此项
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <p>{revision.reason}</p>
                <Link to={`/collections/${revision.id}`}>收藏、记录穿着与快照详情</Link>
                {!!revision.unmet_requirements.length && (
                  <details open>
                    <summary>未满足条件与不确定性</summary>
                    <ul>
                      {revision.unmet_requirements.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {revision.id !== s.selected_revision_id && (
                  <Button
                    disabled={c.busy}
                    onClick={() => c.patch({ selected_revision_id: revision.id })}
                  >
                    选择此方案
                  </Button>
                )}
              </article>
            ))}
          </div>
          {s.selected_revision_id && (
            <>
              <Button disabled={c.busy} onClick={() => c.adjust('rebuild_unlocked', [], '')}>
                重搭未锁定部分
              </Button>
              <OutfitChat key={s.id} sessionId={s.id} controller={c} />
            </>
          )}
          <details open>
            <summary>已发送消息</summary>
            {s.messages.map((m) => (
              <p key={m.id}>
                <strong>{m.role === 'user' ? '你' : '助手'}：</strong>
                {m.content}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  )
}
