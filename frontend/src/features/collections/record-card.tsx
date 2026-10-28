import { Link } from 'react-router'
import { Heart, MoreHorizontal } from 'lucide-react'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import { useState } from 'react'
import type { Revision } from '../outfits'
import type { Favorite, History, Wear } from './api'
import type { RecordAction } from './action-form'
import { RecordPreview } from './preview'

export function RecordCard({
  revision,
  favorite,
  history,
  wear,
  returnTo,
  onAction,
  busy,
  favoritesReady,
  recordOn,
}: {
  revision: Revision
  favorite?: Favorite
  history?: History
  wear?: Wear
  returnTo: string
  onAction: (action: RecordAction) => void
  busy: boolean
  favoritesReady: boolean
  recordOn?: string
}) {
  const [more, setMore] = useState(false)
  const title =
    favorite?.name ||
    revision.items
      .filter((item) => item.source === 'wardrobe')
      .slice(0, 2)
      .map((item) => String(item.attributes.name || '单品'))
      .join(' · ') ||
    '一套搭配'
  const choose = (action: RecordAction) => {
    setMore(false)
    onAction(action)
  }
  return (
    <article className="record-card">
      <Link
        className="record-card-link"
        to={`/collections/${revision.id}`}
        state={{ recordReturnTo: returnTo }}
        aria-label={`查看搭配：${title}`}
      >
        <RecordPreview revision={revision} />
        <h3>{title}</h3>
        <p className="muted">
          {wear
            ? `${wear.worn_on} · 实际穿着`
            : new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(revision.created_at))}
          {favorite && ' · 已收藏'}
        </p>
      </Link>
      {wear?.notes && <p className="record-notes">{wear.notes}</p>}
      <div className="record-card-actions">
        <button
          disabled={busy || !favoritesReady}
          onClick={() =>
            onAction({
              kind: favorite ? 'remove-favorite' : 'favorite',
              revision,
              ...(favorite ? { favorite } : {}),
            } as RecordAction)
          }
          aria-label={favorite ? '取消收藏这套' : '收藏这套'}
        >
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
          {favorite ? '已收藏' : favoritesReady ? '收藏' : '读取中'}
        </button>
        <button
          disabled={busy}
          onClick={() => onAction({ kind: 'wear', revision, wear, date: recordOn })}
        >
          {wear ? '编辑记录' : '记录穿着'}
        </button>
        <Sheet
          title="搭配操作"
          open={more}
          onOpenChange={setMore}
          trigger={
            <button aria-label="更多搭配操作" disabled={busy}>
              <MoreHorizontal size={20} />
            </button>
          }
        >
          <div className="record-more">
            <Button variant="outline" onClick={() => choose({ kind: 'reuse', revision })}>
              以这套为基础搭配
            </Button>
            {favorite && (
              <Button
                variant="outline"
                onClick={() => choose({ kind: 'favorite', revision, favorite })}
              >
                修改收藏名称
              </Button>
            )}
            {history && (
              <Button
                variant="outline"
                onClick={() => choose({ kind: 'remove-history', revision, history })}
              >
                从历史移除
              </Button>
            )}
            {wear && (
              <Button
                variant="outline"
                onClick={() => choose({ kind: 'remove-wear', revision, wear })}
              >
                删除穿着记录
              </Button>
            )}
          </div>
        </Sheet>
      </div>
    </article>
  )
}
