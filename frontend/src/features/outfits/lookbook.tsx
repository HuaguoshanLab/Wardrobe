import { OutfitsPanel } from './panel'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Check, Sparkles, Shirt, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/button'
import type { OutfitController } from './use-outfits'
import { Sheet } from '../../components/ui/sheet'
import { LookbookPiece } from './lookbook-piece'
import './lookbook-stage.css'
import { OutfitStatus } from './task-status'
import './outfits.css'
import './lookbook.css'

export function OutfitLookbook({
  controller: c,
  preparePath,
}: {
  controller: OutfitController
  preparePath: string
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [preview, setPreview] = useState<{ id: string; selection: string | null } | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const s = c.session
  const revisions = s?.revisions ?? []
  const revision =
    revisions.find(
      (item) => item.id === (preview?.selection === s?.selected_revision_id ? preview?.id : null),
    ) ??
    revisions.find((item) => item.id === s?.selected_revision_id) ??
    revisions[0]
  const setPreviewId = (id: string) =>
    setPreview({ id, selection: s?.selected_revision_id ?? null })
  const selected = !!revision && revision.id === s?.selected_revision_id
  const number = revisions.findIndex((item) => item.id === revision?.id) + 1
  const pieces = revision?.items.filter((item) => item.source === 'wardrobe') ?? []
  const suggestions = revision?.items.filter((item) => item.source === 'suggestion') ?? []
  return (
    <>
      <OutfitStatus controller={c} compact />
      {c.loading ? (
        <div className="lookbook-loading" role="status">
          正在打开你的搭配…
        </div>
      ) : !revision ? (
        <section className="lookbook-empty">
          <div className="empty-hanger">
            <Shirt size={72} strokeWidth={1} aria-hidden="true" />
          </div>
          <span className="eyebrow">A LITTLE INSPIRATION</span>
          <h2>今天，从喜欢的衣服开始</h2>
          <p>
            {c.active
              ? '搭配准备中，完成后会出现在这里。'
              : '用衣橱里的单品，搭一套适合今天的穿着。'}
          </p>
          <Link to={preparePath} className="button button-primary">
            <Sparkles size={18} aria-hidden="true" />
            准备搭配
          </Link>
          <Link to="/wardrobe" className="text-link">
            先看看我的衣橱
          </Link>
        </section>
      ) : (
        <>
          <div className="lookbook-toolbar">
            <div className="lookbook-switcher" role="group" aria-label="浏览搭配方案">
              {revisions.map((item, index) => (
                <button
                  key={item.id}
                  aria-pressed={revision.id === item.id}
                  onClick={() => setPreviewId(item.id)}
                >
                  方案 {String(index + 1).padStart(2, '0')}
                  {item.id === s?.selected_revision_id && <Check size={14} aria-label="已选用" />}
                </button>
              ))}
            </div>
            <span className="lookbook-count">
              {number} / {revisions.length}
            </span>
          </div>
          <article className="lookbook" aria-label={`方案 ${number}`}>
            <div className="lookbook-meta">
              <span>
                {selected ? '已选用' : '预览方案'} ·{' '}
                {new Date(revision.created_at).toLocaleDateString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
              </span>
              {revision.provider_mode === 'fake' && <span className="badge">Fake 模拟</span>}
            </div>
            <div
              className={`lookbook-board ${pieces.length === 1 ? 'single-piece' : ''}`}
              onTouchStart={(e) => {
                swiped.current = false
                touch.current =
                  e.touches.length === 1
                    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                    : null
              }}
              onTouchCancel={() => {
                touch.current = null
              }}
              onTouchEnd={(e) => {
                if (!touch.current) return
                const dx = e.changedTouches[0].clientX - touch.current.x
                const dy = e.changedTouches[0].clientY - touch.current.y
                touch.current = null
                if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                  swiped.current = true
                  const next = number - 1 + (dx < 0 ? 1 : -1)
                  if (revisions[next]) setPreviewId(revisions[next].id)
                }
              }}
              onClickCapture={(e) => {
                if (swiped.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  swiped.current = false
                }
              }}
            >
              <div className="stage-weather">
                <span>生成时天气</span>
                <strong>{String(revision.weather_snapshot.temperature_c ?? '未知')}℃</strong>
                <span>{String(revision.weather_snapshot.condition ?? '天气未知')}</span>
              </div>
              {pieces.map((item) => (
                <LookbookPiece
                  key={revision.id + item.item_id}
                  item={item}
                  controller={c}
                  selected={selected}
                />
              ))}
              <div className="stage-details">
                <Sheet
                  title="搭配说明"
                  trigger={
                    <button className="stage-detail-button">
                      搭配说明
                      {revision.unmet_requirements.length > 0 &&
                        ` · ${revision.unmet_requirements.length} 项提醒`}
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  }
                >
                  <p>{revision.reason}</p>
                  <p>
                    生成时天气：{String(revision.weather_snapshot.temperature_c ?? '未知')}℃ ·{' '}
                    {String(revision.weather_snapshot.condition ?? '未知')}（
                    {revision.weather_snapshot.source === 'manual' ? '手动填写' : '和风天气'}）
                  </p>
                  {!!revision.unmet_requirements.length && (
                    <>
                      <h3>穿着前留意</h3>
                      <ul>
                        {revision.unmet_requirements.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </Sheet>
                <Link to={`/collections/${revision.id}`} className="stage-detail-button">
                  收藏 / 记录穿着
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </div>
            <p className="stage-hint">
              {revisions.length > 1 ? '左右滑动浏览 · ' : ''}轻触单品查看
            </p>
            {suggestions.length > 0 && (
              <div className="lookbook-suggestions">
                <strong>未拥有建议</strong>
                {suggestions.map((item) => (
                  <p key={item.item_id}>{item.description}</p>
                ))}
              </div>
            )}
          </article>
          <div className="lookbook-actions">
            <Link to={preparePath} className="button button-outline">
              <RefreshCw size={17} aria-hidden="true" />
              换一套
            </Link>
            {selected ? (
              <Sheet
                title="调整这套"
                open={searchParams.get('adjust') === '1'}
                onOpenChange={(open) => {
                  const next = new URLSearchParams(searchParams)
                  if (open) next.set('adjust', '1')
                  else next.delete('adjust')
                  setSearchParams(next, { replace: true, preventScrollReset: true })
                }}
                trigger={<button className="button button-primary">调整这套</button>}
              >
                <OutfitsPanel controller={c} />
              </Sheet>
            ) : (
              <Button
                disabled={c.busy}
                onClick={() => c.patch({ selected_revision_id: revision.id })}
              >
                选用这套
              </Button>
            )}
          </div>
          {!!s?.invalid_garment_ids.length && (
            <p className="lookbook-warning" role="status">
              部分单品已不可用，重新穿着前请到“调整这套”检查或替换。
            </p>
          )}
        </>
      )}
    </>
  )
}
