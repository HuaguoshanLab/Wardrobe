import '../outfits/outfits.css'
import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { z } from 'zod'
import { Button } from '../../components/ui/button'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation, type OperationController } from '../../lib/use-operation'
import { favoriteSchema, getFavorites, getHistory, getWears, today, wearSchema } from './api'

function FavoriteEditor({
  item,
  op,
}: {
  item: z.infer<typeof favoriteSchema>
  op: OperationController
}) {
  const [name, setName] = useState(item.name)
  return (
    <div className="attribute-form">
      <label>
        收藏名称
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="actions">
        <Button
          disabled={op.busy}
          onClick={() =>
            op.send(`/favorites/${item.id}`, 'PATCH', { expected_version: item.version, name })
          }
        >
          保存名称
        </Button>
        <Button
          variant="outline"
          disabled={op.busy}
          onClick={() => op.send(`/favorites/${item.id}`, 'DELETE', undefined, item.version)}
        >
          取消收藏
        </Button>
      </div>
    </div>
  )
}

export function CollectionsPage() {
  const [tab, setTab] = useState<'history' | 'favorites'>('history')
  const op = useOperation('collections')
  const history = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => getHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const favorites = useInfiniteQuery({
    queryKey: ['favorites'],
    queryFn: ({ pageParam }) => getFavorites(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const selected = tab === 'history' ? history : favorites
  const rows =
    tab === 'history'
      ? history.data?.pages.flatMap((p) =>
          p.items.map((item) => ({
            key: item.revision.id,
            revision: item.revision,
            history: item,
            favorite: null,
          })),
        )
      : favorites.data?.pages.flatMap((p) =>
          p.items.map((item) => ({
            key: item.id,
            revision: item.revision,
            history: null,
            favorite: item,
          })),
        )
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE STYLE ARCHIVE</span>
          <h1>历史与收藏</h1>
          <p>保存每一次生成与调整的固定版本。</p>
        </div>
      </div>
      <div className="segmented-control" role="group" aria-label="记录类型">
        <Button
          aria-pressed={tab === 'history'}
          variant={tab === 'history' ? 'default' : 'outline'}
          onClick={() => setTab('history')}
        >
          历史
        </Button>
        <Button
          aria-pressed={tab === 'favorites'}
          variant={tab === 'favorites' ? 'default' : 'outline'}
          onClick={() => setTab('favorites')}
        >
          收藏
        </Button>
      </div>
      <OperationNotice operation={op} />
      {selected.isPending && <p>正在载入…</p>}
      {selected.error && <p role="alert">{selected.error.message}</p>}
      {rows?.length === 0 && (
        <p>
          还没有
          {tab === 'history' ? '搭配历史，先到首页生成搭配。' : '收藏，打开搭配详情即可收藏。'}
        </p>
      )}
      <div className="outfit-grid">
        {rows?.map((row) => (
          <article className="outfit-card" key={row.key}>
            <h2>{row.favorite?.name || '搭配快照'}</h2>
            <small>
              {new Date(row.revision.created_at).toLocaleString('zh-CN')} ·{' '}
              {row.revision.provider_mode === 'fake' ? 'Fake 模拟' : '千问'}
            </small>
            <div className="outfit-items">
              {row.revision.items
                .filter((i) => i.image_url)
                .map((i) => (
                  <div className="outfit-item" key={i.item_id}>
                    <img
                      loading="lazy"
                      src={i.image_url!}
                      alt={String(i.attributes.name ?? '单品快照')}
                    />
                  </div>
                ))}
            </div>
            <details className="outfit-reason">
              <summary>搭配说明</summary>
              <p>{row.revision.reason}</p>
            </details>
            <Link to={`/collections/${row.revision.id}`}>查看详情、收藏或记录穿着</Link>
            {row.history && (
              <Button
                variant="outline"
                disabled={op.busy}
                onClick={() => {
                  if (
                    window.confirm('从历史隐藏此版本？相关会话将清空选择，收藏和穿着记录仍保留。')
                  )
                    op.send(
                      `/outfit-revisions/${row.revision.id}`,
                      'DELETE',
                      undefined,
                      row.history!.version,
                    )
                }}
              >
                从历史删除
              </Button>
            )}
            {row.favorite && (
              <FavoriteEditor
                key={`${row.favorite.id}:${row.favorite.version}`}
                item={row.favorite}
                op={op}
              />
            )}
          </article>
        ))}
      </div>
      {selected.hasNextPage && (
        <Button
          disabled={selected.isFetchingNextPage}
          onClick={() => void selected.fetchNextPage()}
        >
          加载更多
        </Button>
      )}
    </>
  )
}

function WearEditor({ item, op }: { item: z.infer<typeof wearSchema>; op: OperationController }) {
  const [date, setDate] = useState(item.worn_on)
  const [notes, setNotes] = useState(item.notes)
  return (
    <article className="panel attribute-form">
      <h2>{item.worn_on} · 实际穿着</h2>
      <Link to={`/collections/${item.revision_id}`}>查看当时搭配</Link>
      <label>
        穿着日期
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        备注
        <textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="actions">
        <Button
          disabled={op.busy || !date}
          onClick={() =>
            op.send(`/wear-records/${item.id}`, 'PATCH', {
              expected_version: item.version,
              worn_on: date,
              notes,
            })
          }
        >
          保存穿着记录
        </Button>
        <Button
          variant="outline"
          disabled={op.busy}
          onClick={() => {
            if (window.confirm('删除这条穿着记录？搭配快照仍保留。'))
              op.send(`/wear-records/${item.id}`, 'DELETE', undefined, item.version)
          }}
        >
          删除穿着记录
        </Button>
      </div>
    </article>
  )
}

export function CalendarPage() {
  const [month, setMonth] = useState(() => today().slice(0, 7))
  const start = `${month}-01`
  const [year, number] = month.split('-').map(Number)
  const end = `${month}-${new Date(year, number, 0).getDate()}`
  const op = useOperation('collections')
  const query = useInfiniteQuery({
    queryKey: ['wears', month],
    queryFn: ({ pageParam }) => getWears(start, end, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const items = query.data?.pages
    .flatMap((p) => p.items)
    .sort((a, b) => b.worn_on.localeCompare(a.worn_on))
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DAYS WELL DRESSED</span>
          <h1>穿搭日历</h1>
          <p>只记录实际穿过的搭配；可从搭配详情补记。</p>
        </div>
      </div>
      <label>
        月份
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      <OperationNotice operation={op} />
      {query.isPending && <p>正在载入…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {items?.length === 0 && (
        <div className="empty-state">
          <h2>这个月，留一点穿搭记忆</h2>
          <p>本月还没有穿着记录。打开搭配详情，记录实际穿过的那一套。</p>
          <Link to="/collections" className="button button-outline">
            查看历史搭配
          </Link>
        </div>
      )}
      {items?.map((item) => (
        <WearEditor key={`${item.id}:${item.version}`} item={item} op={op} />
      ))}
      {query.hasNextPage && (
        <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          加载更多
        </Button>
      )}
    </>
  )
}
