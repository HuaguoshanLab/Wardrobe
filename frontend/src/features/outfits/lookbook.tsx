import { OutfitActions } from '../collections'
import { OutfitExplanation, formatTemperature } from './explanation'
import { OutfitsPanel } from './panel'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Check, Sparkles, Shirt, ListChecks, RefreshCw, SlidersHorizontal } from 'lucide-react'
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
  const [feedbackContainer, setFeedbackContainer] = useState<HTMLDivElement | null>(null)
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
          <div className="lookbook-skeleton" aria-hidden="true" />
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
                <strong className="lookbook-selection">{selected ? '当前选用' : '方案预览'}</strong>
              </span>
              <span>
                保存于{' '}
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
              <div className="stage-composition">
                <div className="stage-weather">
                  <span className="weather-film" aria-hidden="true" />
                  <span>生成时</span>
                  <strong
                    className={
                      typeof revision.weather_snapshot.temperature_c === 'number'
                        ? undefined
                        : 'weather-temperature-unknown'
                    }
                  >
                    {formatTemperature(revision.weather_snapshot.temperature_c)}
                  </strong>
                  <span className="weather-condition" title="完整天气见搭配说明">
                    {String(revision.weather_snapshot.condition ?? '天气未知')}
                  </span>
                </div>
                <div className="stage-garments">
                  {pieces.map((item) => (
                    <LookbookPiece
                      key={revision.id + item.item_id}
                      item={item}
                      controller={c}
                      selected={selected}
                    />
                  ))}
                </div>
                <aside className="stage-tools" aria-label="这套搭配的操作">
                  <OutfitActions
                    key={revision.id}
                    revision={revision}
                    feedbackContainer={feedbackContainer}
                  />
                  <div className="stage-details">
                    <Sheet
                      title="搭配说明"
                      trigger={
                        <button className="stage-detail-button">
                          <ListChecks size={21} aria-hidden="true" />
                          <span>搭配说明</span>
                          {revision.unmet_requirements.length > 0 && (
                            <span className="stage-reminders">
                              {revision.unmet_requirements.length} 项提醒
                            </span>
                          )}
                        </button>
                      }
                    >
                      <OutfitExplanation revision={revision} />
                    </Sheet>
                  </div>
                  <div className="lookbook-actions">
                    <Link to={preparePath} className="button button-outline">
                      <RefreshCw size={17} aria-hidden="true" />
                      重新搭配
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
                        trigger={
                          <button className="button button-primary">
                            <SlidersHorizontal size={21} aria-hidden="true" />
                            <span>调整这套</span>
                          </button>
                        }
                      >
                        <OutfitsPanel
                          controller={c}
                          onAccepted={() => {
                            const next = new URLSearchParams(searchParams)
                            next.delete('adjust')
                            setSearchParams(next, { replace: true, preventScrollReset: true })
                          }}
                        />
                      </Sheet>
                    ) : (
                      <Button
                        disabled={c.busy}
                        onClick={() => c.patch({ selected_revision_id: revision.id })}
                      >
                        <Check size={21} aria-hidden="true" />
                        <span>选用这套</span>
                      </Button>
                    )}
                  </div>
                </aside>
              </div>
            </div>
            <div className="stage-feedback" ref={setFeedbackContainer} />
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
