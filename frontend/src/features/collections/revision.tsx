import { useQuery } from '@tanstack/react-query'
import { useLocation, useParams } from 'react-router'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/ui/page-header'
import { getAllFavorites, getRevision, recordDay, isPastDay } from './api'
import { useRecordActions } from './actions'
import { Snapshot } from './snapshot'
import './records.css'
export { Snapshot } from './snapshot'

export function RevisionPage() {
  const { revisionId = '' } = useParams()
  const state = useLocation().state as { recordReturnTo?: unknown } | null
  const returnTo =
    typeof state?.recordReturnTo === 'string' && /^\/collections(?:\?|$)/.test(state.recordReturnTo)
      ? state.recordReturnTo
      : '/collections'
  const recordOn = new URLSearchParams(returnTo.split('?')[1]).get('record_on') ?? ''
  const query = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => getRevision(revisionId),
  })
  const favorites = useQuery({
    queryKey: ['favorites', 'all'],
    queryFn: getAllFavorites,
    staleTime: 30_000,
  })
  const favorite = favorites.data?.find((item) => item.revision_id === revisionId)
  const actions = useRecordActions()
  const revision = query.data
  return (
    <section className="record-detail subpage">
      <PageHeader title="搭配详情" backTo={returnTo} backLabel="返回穿搭记录" />
      {query.isPending && (
        <div className="record-skeleton" role="status">
          正在读取搭配…
        </div>
      )}
      {query.error && (
        <p className="error" role="alert">
          {query.error.message}
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新读取搭配
          </Button>
        </p>
      )}
      {actions.feedback}
      {revision && (
        <>
          <div className="record-detail-heading">
            <div>
              <span className="eyebrow">{recordDay(revision.created_at)}</span>
              <h1>{favorite?.name || '留住这一天的搭配'}</h1>
            </div>
            {revision.provider_mode === 'fake' && (
              <span className="record-simulation">模拟搭配</span>
            )}
          </div>
          <p className="muted">保留当时的衣服和图片，点击单品查看当时属性。</p>
          <Snapshot revision={revision} />
          {favorites.error && (
            <p className="error" role="alert">
              收藏状态读取失败。
              <Button variant="outline" onClick={() => void favorites.refetch()}>
                重试收藏状态
              </Button>
            </p>
          )}
          <div className="record-detail-actions">
            <Button
              variant="outline"
              disabled={actions.busy || !favorites.isSuccess}
              onClick={() => actions.open({ kind: 'favorite', revision, favorite })}
            >
              {favorite ? '已收藏 · 改名' : favorites.isPending ? '读取收藏状态…' : '收藏这套'}
            </Button>
            <Button
              disabled={actions.busy}
              onClick={() =>
                actions.open({
                  kind: 'wear',
                  revision,
                  date: isPastDay(recordOn) ? recordOn : undefined,
                })
              }
            >
              记录穿着
            </Button>
          </div>
          <div className="record-secondary-actions">
            <Button
              variant="outline"
              disabled={actions.busy}
              onClick={() => actions.open({ kind: 'reuse', revision })}
            >
              以这套为基础搭配
            </Button>
            {favorite && (
              <button
                className="text-link"
                disabled={actions.busy}
                onClick={() => actions.open({ kind: 'remove-favorite', revision, favorite })}
              >
                取消收藏
              </button>
            )}
          </div>
        </>
      )}
      {actions.panel}
    </section>
  )
}
