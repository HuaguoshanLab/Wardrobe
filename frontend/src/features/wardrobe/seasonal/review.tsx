import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useSearchParams } from 'react-router'
import { Button } from '../../../components/ui/button'
import type { OperationController } from '../../../lib/use-operation'
import { labels } from '../lifecycle-api'
import { ItemFilter, matchesSearch } from './item-filter'
import type { Seasonal, SeasonalItem } from './api'

export function Review({
  session,
  operation,
  onDirty,
}: {
  session: Seasonal
  operation: OperationController
  onDirty: (v: boolean) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const latestParams = useRef(params)
  useEffect(() => {
    latestParams.current = params
  }, [params])
  const filter = params.get('review') ?? 'pending'
  const search = params.get('find') ?? ''
  const deferred = useDeferredValue(search)
  const change = (key: string, value: string) => {
    // Search-param navigations can overlap before React commits the previous one.
    const next = new URLSearchParams(latestParams.current)
    if (value) next.set(key, value)
    else next.delete(key)
    latestParams.current = next
    setParams(next, { replace: true, preventScrollReset: true })
  }
  const [dirty, setDirty] = useState(false)
  const matches = (i: SeasonalItem, group: string) =>
    group === 'all' ||
    (group === 'stale'
      ? i.stale
      : group === 'todo'
        ? !!i.todo
        : !i.reviewed_version || i.stale || !i.current)
  const groups = [
    { key: 'pending', label: '待核对' },
    { key: 'stale', label: '已变化' },
    { key: 'todo', label: '有待办' },
    { key: 'all', label: '全部' },
  ].map((g) => ({ ...g, count: session.items.filter((i) => matches(i, g.key)).length }))
  const items = session.items.filter((i) => matches(i, filter) && matchesSearch(i, deferred))
  const markDirty = useCallback(
    (value: boolean) => {
      setDirty(value)
      onDirty(value)
    },
    [onDirty],
  )
  return (
    <section className="seasonal-section">
      <div className="seasonal-section-heading">
        <div>
          <h2>先看看衣服的真实状态</h2>
          <p>核对分类、状况与合身情况；未知资料可以继续保留未知。</p>
        </div>
      </div>
      <ItemFilter
        search={search}
        onSearch={(v) => change('find', v)}
        filter={filter}
        onFilter={(v) => change('review', v)}
        groups={groups}
        disabled={dirty || operation.busy}
      />
      {!items.length && (
        <p className="seasonal-empty">
          {session.items.length
            ? search || filter !== 'pending'
              ? '当前分组没有匹配单品，可切换分组或清空搜索。'
              : '本轮单品已核对，可以继续调整目标。'
            : '当前范围没有单品。可以返回新建另一轮整理，或保存空范围总结。'}
        </p>
      )}
      <div className="seasonal-items">
        {items.map((i) => {
          const g = i.current ?? i.original
          return (
            <article className="panel seasonal-item" key={i.garment_id}>
              <img src={g.image_url} alt="" loading="lazy" />
              <div className="seasonal-item-info">
                <h3>{g.name ?? '未命名单品'}</h3>
                <p className={`seasonal-status ${i.stale ? 'is-attention' : ''}`}>
                  {!i.current
                    ? '已删除 · 原始记录'
                    : g.ownership === 'retired'
                      ? '已退出衣橱'
                      : i.stale
                        ? '资料已变化 · 请重新核对'
                        : i.reviewed_version
                          ? '已核对'
                          : '待核对'}
                </p>
                <p>
                  {labels.condition[g.lifecycle.condition]} · {labels.fit[g.lifecycle.fit]} ·{' '}
                  {labels.storage[g.lifecycle.storage]}
                </p>
                {i.todo && <p className="seasonal-attention">待办：{i.todo}</p>}
              </div>
              {i.current && editing !== i.garment_id && (
                <Button
                  variant="outline"
                  disabled={dirty || operation.busy}
                  onClick={() => setEditing(i.garment_id)}
                >
                  {i.reviewed_version ? '重新核对' : '核对这件'}
                </Button>
              )}
              {editing === i.garment_id && i.current && (
                <ReviewForm
                  key={i.garment_id}
                  item={i}
                  session={session}
                  operation={operation}
                  onDirty={markDirty}
                  onClose={() => {
                    markDirty(false)
                    setEditing(null)
                  }}
                />
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
function ReviewForm({
  item,
  session,
  operation,
  onDirty,
  onClose,
}: {
  item: SeasonalItem
  session: Seasonal
  operation: OperationController
  onDirty: (v: boolean) => void
  onClose: () => void
}) {
  const location = useLocation()
  const returnState = { seasonalReturn: location.pathname + location.search }
  const form = useForm({
    defaultValues: { reviewed: !!item.reviewed_version && !item.stale, todo: item.todo },
  })
  const [version, setVersion] = useState(item.current!.version)
  const [sessionVersion, setSessionVersion] = useState(session.version)
  const dirty = form.formState.isDirty
  // Parent prevents a stage switch from throwing away this draft.
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])
  return (
    <form
      className="seasonal-form seasonal-review-form"
      onSubmit={form.handleSubmit((values) =>
        operation.send(`/seasonal-sessions/${session.id}/progress`, 'POST', {
          expected_version: sessionVersion,
          stage: 'review',
          items: [{ garment_id: item.garment_id, garment_version: version, ...values }],
        }),
      )}
    >
      {(version !== item.current!.version || sessionVersion !== session.version) && (
        <div role="status" className="seasonal-attention">
          <p>资料或进度已变化，当前输入仍保留。请重新查看最新资料后确认。</p>
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => {
              setVersion(item.current!.version)
              setSessionVersion(session.version)
              form.setValue('reviewed', false, { shouldDirty: true })
            }}
          >
            保留待办，重新核对最新资料
          </Button>
        </div>
      )}
      <fieldset disabled={operation.busy}>
        <div className="seasonal-buttons">
          <Link className="text-link" state={returnState} to={`/wardrobe/${item.garment_id}`}>
            修改分类与属性
          </Link>
          <Link
            className="text-link"
            state={returnState}
            to={`/wardrobe/${item.garment_id}/lifecycle`}
          >
            修改状况与资料
          </Link>
        </div>
        <label className="seasonal-check">
          <input type="checkbox" {...form.register('reviewed')} />
          已查看当前资料与实际状况
        </label>
        <label>
          留给自己的待办
          <textarea
            rows={2}
            maxLength={500}
            placeholder="例如：试穿后再决定是否保留"
            {...form.register('todo')}
          />
        </label>
        <p className="muted">保存核对不会修改衣服。前往其他页面修改后，返回需重新核对。</p>
      </fieldset>
      <div className="seasonal-buttons">
        <Button type="submit" disabled={operation.busy}>
          保存这件核对
        </Button>
        <Button variant="outline" disabled={operation.busy} onClick={onClose}>
          取消未保存修改
        </Button>
      </div>
    </form>
  )
}
