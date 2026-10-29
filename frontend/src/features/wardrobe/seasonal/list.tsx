import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { ArrowRight, Leaf } from 'lucide-react'
import { PageHeader } from '../../../components/ui/page-header'
import { Button } from '../../../components/ui/button'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { entityId } from '../../../lib/id'
import { getTaxonomy } from '../api'
import { seasons, type Season } from '../inventory/api'
import { getSessions, sessionSchema } from './api'
import { SessionRecords } from './session-records'
import './seasonal.css'

export function SeasonalList() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const form = useForm<{ season: Season; scope: 'season' | 'all'; category: string }>({
    defaultValues: { season: 'spring', scope: 'season', category: '' },
  })
  const op = useOperation('seasonal-create', (value) => {
    const parsed = sessionSchema.safeParse(value)
    if (parsed.success) void navigate(`/wardrobe/seasonal/${parsed.data.id}`)
  })
  const query = useInfiniteQuery({
    queryKey: ['seasonal-sessions'],
    queryFn: ({ pageParam }) => getSessions(pageParam),
    initialPageParam: '',
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: getTaxonomy })
  const sessions =
    query.data?.pages
      .flatMap((p) => p.items)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)) ?? []
  return (
    <div className="seasonal-page">
      <PageHeader title="换季整理" backTo="/wardrobe" backLabel="返回衣橱" />
      <section className="seasonal-intro">
        <Leaf size={28} aria-hidden="true" />
        <div>
          <span className="seasonal-status">换季，从一件开始</span>
          <h2>一件一件，为下一季留好位置</h2>
          <p>先核对，再决定。随时暂停，下次从已保存的进度继续。</p>
        </div>
      </section>
      <OperationNotice operation={op} />
      <section className="panel seasonal-section seasonal-create">
        <h2>开始一轮整理</h2>
        {!creating ? (
          <Button disabled={op.busy} onClick={() => setCreating(true)}>
            选择季节与范围 <ArrowRight size={16} aria-hidden="true" />
          </Button>
        ) : (
          <form
            className="seasonal-form"
            onSubmit={form.handleSubmit((values) =>
              op.send('/seasonal-sessions', 'POST', {
                id: entityId(),
                season: values.season,
                scope: values.scope,
                categories: values.category ? [values.category] : [],
              }),
            )}
          >
            <fieldset disabled={op.busy}>
              <label>
                整理季节
                <select {...form.register('season')}>
                  {Object.entries(seasons).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}季
                    </option>
                  ))}
                </select>
              </label>
              <label>
                整理范围
                <select {...form.register('scope')}>
                  <option value="season">本季与季节未知的衣服</option>
                  <option value="all">全部持有的衣服</option>
                </select>
              </label>
              <label>
                品类
                <select {...form.register('category')}>
                  <option value="">全部品类</option>
                  {Object.entries(taxonomy.data?.fields.category ?? {}).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                仅纳入正式持有的单品。创建时固定本轮范围，后来新增的衣服会单独提醒。
              </p>
            </fieldset>
            <div className="seasonal-buttons">
              <Button type="submit" disabled={op.busy}>
                创建并开始核对
              </Button>
              <Button
                variant="outline"
                disabled={op.busy}
                onClick={() => {
                  form.reset()
                  setCreating(false)
                }}
              >
                取消
              </Button>
            </div>
          </form>
        )}
      </section>
      <section className="seasonal-section">
        {query.isPending && <p role="status">正在读取整理记录…</p>}
        {query.isError && (
          <p role="alert">
            {query.error.message}{' '}
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新读取
            </Button>
          </p>
        )}
        {query.isSuccess && !sessions.length && (
          <p className="seasonal-empty">还没有整理记录。从一个季节、一个品类开始就好。</p>
        )}
        {sessions.length > 0 && (
          <SessionRecords
            items={sessions}
            more={query.hasNextPage}
            categories={taxonomy.data?.fields.category ?? {}}
          />
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            加载更多记录
          </Button>
        )}
      </section>
    </div>
  )
}
