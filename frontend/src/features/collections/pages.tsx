import { useEffect, useLayoutEffect, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/button'
import { getAllFavorites, getHistory, getMonthWears, recordDay, today, isPastDay } from './api'
import { useRecordActions } from './actions'
import { RecordCard } from './record-card'
import { RecordCalendar } from './calendar'
import './records.css'

export function CollectionsPage() {
  const [params, setParams] = useSearchParams(
    sessionStorage.getItem('wardrobe.records.location') ?? 'view=history',
  )
  const view = ['history', 'favorites', 'calendar'].includes(params.get('view') ?? '')
    ? params.get('view')!
    : 'history'
  const rawMonth = params.get('month') ?? ''
  const month =
    /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) &&
    rawMonth >= '1900-01' &&
    rawMonth <= today().slice(0, 7)
      ? rawMonth
      : today().slice(0, 7)
  const rawDate = params.get('date') ?? ''
  const date =
    rawDate.startsWith(`${month}-`) && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today()
      ? rawDate
      : month === today().slice(0, 7)
        ? today()
        : `${month}-01`
  const recordOn = isPastDay(params.get('record_on') ?? '') ? params.get('record_on')! : undefined
  const update = (changes: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(changes)) next.set(key, value)
        return next
      },
      { replace: true },
    )
  useEffect(() => {
    sessionStorage.setItem('wardrobe.records.location', params.toString())
  }, [params])
  const actions = useRecordActions()
  const history = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam }) => getHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: view === 'history',
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  })
  const favorites = useQuery({
    queryKey: ['favorites', 'all'],
    queryFn: getAllFavorites,
    staleTime: 30_000,
  })
  const wears = useQuery({
    queryKey: ['wears', month],
    queryFn: () => getMonthWears(month),
    enabled: view === 'calendar',
    staleTime: 30_000,
  })
  const active = view === 'history' ? history : view === 'favorites' ? favorites : wears
  const region = useRef<HTMLDivElement>(null)
  const position = useRef(0)
  const scrollKey = `wardrobe.records.scroll:${params}`
  useLayoutEffect(() => {
    position.current = Number(sessionStorage.getItem(scrollKey) ?? 0)
    if (region.current) region.current.scrollTop = position.current
    return () => {
      sessionStorage.setItem(scrollKey, String(position.current))
    }
  }, [scrollKey])
  useLayoutEffect(() => {
    if (!active.isPending && region.current) region.current.scrollTop = position.current
  }, [active.isPending, scrollKey])
  const rows =
    view === 'history'
      ? history.data?.pages.flatMap((page) =>
          page.items.map((entry) => ({
            key: entry.revision.id,
            revision: entry.revision,
            history: entry,
            wear: undefined,
            favorite: favorites.data?.find((f) => f.revision_id === entry.revision.id),
            day: recordDay(entry.revision.created_at),
          })),
        )
      : view === 'favorites'
        ? favorites.data?.map((favorite) => ({
            key: favorite.id,
            revision: favorite.revision,
            favorite,
            history: undefined,
            wear: undefined,
            day: '',
          }))
        : wears.data
            ?.filter((wear) => wear.worn_on === date)
            .map((wear) => ({
              key: wear.id,
              revision: wear.revision,
              wear,
              favorite: favorites.data?.find((f) => f.revision_id === wear.revision_id),
              history: undefined,
              day: '',
            }))
  const groups = new Map<string, Array<NonNullable<typeof rows>[number]>>()
  for (const row of rows ?? []) groups.set(row.day, [...(groups.get(row.day) ?? []), row])
  const returnTo = `/collections?${params}`
  return (
    <section className="records-page">
      <div className="page-heading">
        <div>
          <h1>穿搭记录</h1>
          <p>留住喜欢的搭配，记下穿过的日常。</p>
        </div>
      </div>
      <div className="records-tabs" role="group" aria-label="记录类型">
        {[
          ['history', '历史'],
          ['favorites', '收藏'],
          ['calendar', '日历'],
        ].map(([key, label]) => (
          <button key={key} aria-pressed={view === key} onClick={() => update({ view: key })}>
            {label}
          </button>
        ))}
      </div>
      {recordOn && view !== 'calendar' && (
        <p className="record-backfill">
          补记 {recordOn}：选择搭配后点击「记录穿着」。
          <button
            onClick={() =>
              setParams(
                (previous) => {
                  const next = new URLSearchParams(previous)
                  next.delete('record_on')
                  return next
                },
                { replace: true },
              )
            }
          >
            结束补记
          </button>
        </p>
      )}
      {actions.feedback}
      <div
        className="records-body"
        role="region"
        aria-label="穿搭记录列表"
        tabIndex={0}
        ref={region}
        onScroll={(event) => {
          position.current = event.currentTarget.scrollTop
        }}
      >
        {view === 'calendar' && (
          <RecordCalendar
            month={month}
            date={date}
            items={wears.data ?? []}
            loading={wears.isPending || wears.isError}
            onMonth={(value) =>
              update({
                month: value,
                date: value === today().slice(0, 7) ? today() : `${value}-01`,
              })
            }
            onDate={(value) => update({ month: value.slice(0, 7), date: value })}
          />
        )}
        {view === 'calendar' && (
          <div className="record-day-heading">
            <h2>{date === today() ? '今天' : date}的穿着</h2>
            <Link to={`/collections?view=history&record_on=${date}`} className="text-link">
              从历史补记
            </Link>
          </div>
        )}
        {active.isPending && (
          <div className="record-skeleton" role="status">
            正在读取穿搭记录…
          </div>
        )}
        {active.error && (
          <p className="error" role="alert">
            {active.error.message}
            <Button variant="outline" onClick={() => void active.refetch()}>
              重新读取记录
            </Button>
          </p>
        )}
        {favorites.error && view !== 'favorites' && (
          <p role="alert" className="error">
            收藏状态读取失败。
            <Button variant="outline" onClick={() => void favorites.refetch()}>
              重试收藏状态
            </Button>
          </p>
        )}
        {!active.isPending && !active.error && rows?.length === 0 && (
          <div className="record-empty">
            <h2>
              {view === 'history'
                ? '第一套搭配，从今天开始'
                : view === 'favorites'
                  ? '把喜欢的搭配留在这里'
                  : '这一天还没有穿着记录'}
            </h2>
            <p>
              {view === 'history'
                ? '生成和调整过的搭配，会自动保存在这里。'
                : view === 'favorites'
                  ? '在搭配上点击收藏，下次就能快速找到。'
                  : '只记录实际穿过的搭配，也可以补记以前的日期。'}
            </p>
            <Link
              className="button button-outline"
              to={view === 'history' ? '/' : '/collections?view=history'}
            >
              {view === 'history' ? '去搭配' : '浏览历史搭配'}
            </Link>
          </div>
        )}
        {[...groups].map(([day, entries]) => (
          <section className="record-date-group" key={day}>
            {day && <h2>{day === today() ? '今天' : day}</h2>}
            <div className="record-grid">
              {entries.map(({ key, ...row }) => (
                <RecordCard
                  key={key}
                  {...row}
                  returnTo={returnTo}
                  onAction={actions.open}
                  busy={actions.busy}
                  favoritesReady={favorites.isSuccess}
                  recordOn={recordOn}
                />
              ))}
            </div>
          </section>
        ))}
        {view === 'history' && history.hasNextPage && (
          <div className="record-load">
            <Button
              variant="outline"
              disabled={history.isFetching}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? '正在加载…' : '加载更多'}
            </Button>
          </div>
        )}
      </div>
      {actions.panel}
    </section>
  )
}
export function CalendarPage() {
  return <Navigate to="/collections?view=calendar" replace />
}
