import { useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { getTags, getTaxonomy } from '../api'
import { getCare } from './api'
import { useCareDraft } from './state'
import { useCareOperation } from './use-care-operation'
import { CarePicker } from './picker'
import { CareControls } from './controls'
import { CareActionBar } from './action-bar'
import { CareResults } from './results'
import './care.css'
import './operation.css'

const groups = { washing: '待洗清单', available: '可穿单品', all: '全部单品' }
export function CarePage() {
  const [params, setParams] = useSearchParams()
  const group =
    params.get('group') === 'available'
      ? 'available'
      : params.get('group') === 'all'
        ? 'all'
        : 'washing'
  const q = params.get('q') ?? '',
    category = params.get('category') ?? ''
  const { draft, update, toggle, storageError } = useCareDraft(
    group === 'available' ? 'mark_washing' : 'wash_done',
  )
  const [onlySelected, setOnlySelected] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const editor = useRef<HTMLElement>(null)
  const operation = useCareOperation((failed) => update({ ...draft, selected: failed }))
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const list = useInfiniteQuery({
    queryKey: ['garments', 'care', group, q, category],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      getCare(
        new URLSearchParams({
          group,
          q,
          category,
          limit: '20',
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const rows = Array.from(
    new Map(list.data?.pages.flatMap((p) => p.items).map((g) => [g.id, g]) ?? []).values(),
  )
  const shown = onlySelected ? draft.selected : rows
  const tagAction = draft.action.startsWith('tags_')
  const validTags =
    !tagAction ||
    (!!draft.tag_ids.length &&
      tags.isSuccess &&
      draft.tag_ids.every((id) => tags.data.some((t) => t.id === id)))
  const canConfirm =
    !!draft.selected.length &&
    !operation.busy &&
    validTags &&
    (draft.action !== 'location_set' || !!draft.location.trim())
  const outside = draft.selected.filter((g) => !rows.some((row) => row.id === g.id)).length
  function editAction() {
    editor.current?.scrollIntoView({ block: 'start' })
    editor.current?.querySelector('select')?.focus({ preventScroll: true })
  }
  const returnTo = `/wardrobe/care?${params}`
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
    setOnlySelected(false)
  }
  return (
    <div className="subpage care-page">
      <PageHeader title="洗衣与批量管理" backTo="/wardrobe" backLabel="返回衣橱" />
      <p className="muted">选衣服、核对改动，再一起处理。每次最多 20 件。</p>
      <CareResults
        operation={operation}
        returnTo={returnTo}
        onRetry={() => {
          const saved = operation.saved
          if (!saved) return
          const failed = new Set(
            saved.result.items.filter((i) => !i.success).map((i) => i.garment_id),
          )
          const original = saved.body.items[0]
          update({
            ...draft,
            action: original.action,
            tag_ids: original.tag_ids,
            location: original.location ?? '',
            selected: saved.selected.filter((g) => failed.has(g.id)),
          })
          setOnlySelected(true)
          editAction()
        }}
      />
      {storageError && <p role="alert">{storageError}</p>}
      <div className="care-groups" role="group" aria-label="日常管理分组">
        {Object.entries(groups).map(([v, label]) => (
          <Button
            key={v}
            variant="outline"
            aria-pressed={!onlySelected && group === v}
            onClick={() => {
              filter('group', v)
              if (
                !operation.busy &&
                !draft.selected.length &&
                (v === 'washing' || v === 'available')
              )
                update({ ...draft, action: v === 'washing' ? 'wash_done' : 'mark_washing' })
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <section className="panel care-editor" ref={editor} aria-label="设置批量操作">
        <CareControls
          draft={draft}
          tags={tags.data ?? []}
          loading={tags.isPending}
          busy={operation.busy}
          onChange={update}
        />
        {tags.isError && tagAction && (
          <div role="alert">
            <p>{tags.error.message}</p>
            <Button variant="outline" onClick={() => void tags.refetch()}>
              重新读取标签
            </Button>
          </div>
        )}
        {!validTags && <p className="care-help">请读取并选择有效标签后继续。</p>}
        {draft.action === 'location_set' && !draft.location.trim() && (
          <p className="care-help">请填写新位置；需要清空时请选择“清空收纳位置”。</p>
        )}
      </section>
      <h2 className="care-section-title">选择需要处理的衣服</h2>
      <div className="care-filters">
        <label>
          搜索单品
          <input
            type="search"
            maxLength={100}
            value={q}
            onChange={(e) => filter('q', e.target.value)}
            placeholder="按名称查找"
          />
        </label>
        <label>
          品类
          <select value={category} onChange={(e) => filter('category', e.target.value)}>
            <option value="">全部品类</option>
            {Object.entries(taxonomy.data?.fields.category ?? {}).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="care-selection-bar">
        <Button
          variant="outline"
          aria-pressed={onlySelected}
          onClick={() => setOnlySelected(!onlySelected)}
        >
          只看已选（{draft.selected.length}）
        </Button>
        <Button
          variant="outline"
          disabled={operation.busy || !draft.selected.length}
          onClick={() => update({ ...draft, selected: [] })}
        >
          清空选择
        </Button>
      </div>
      <p className="care-help">筛选和翻页保留选择；草稿已保存在此浏览器。</p>
      {!onlySelected && outside > 0 && (
        <p className="care-selection-note">
          另有 {outside} 件已选单品不在当前载入的列表中，可点“只看已选”核对。
        </p>
      )}
      {draft.selected.length === 20 && (
        <p className="care-selection-note" role="status">
          已选满 20 件，取消一件后可继续选择。
        </p>
      )}
      <CareActionBar
        draft={draft}
        tags={tags.data ?? []}
        busy={operation.busy}
        canConfirm={canConfirm}
        confirming={confirming}
        onEdit={editAction}
        onOpenChange={(value) => setConfirming(value && canConfirm)}
        onConfirm={(body, selected) => {
          operation.send(body, selected)
          setConfirming(false)
        }}
      />
      {!onlySelected && list.isPending && <p role="status">正在读取单品…</p>}
      {!onlySelected && list.isError && (
        <div role="alert">
          <p>{list.error.message}</p>
          <Button variant="outline" onClick={() => void list.refetch()}>
            重新读取清单
          </Button>
        </div>
      )}
      {(onlySelected || !list.isError) && (
        <CarePicker
          items={shown}
          selected={draft.selected}
          onToggle={toggle}
          busy={operation.busy}
          returnTo={returnTo}
        />
      )}
      {!shown.length && (onlySelected || list.isSuccess) && (
        <div className="panel care-empty">
          <h2>
            {onlySelected
              ? '还没有选中单品'
              : group === 'washing' && !q && !category
                ? '暂无待洗单品'
                : '没有符合条件的单品'}
          </h2>
          <p>
            {onlySelected
              ? '切回清单逐件勾选，再核对操作。'
              : '衣服状态由你确认，不会自动标待洗或恢复可穿。'}
          </p>
          {!onlySelected && group === 'all' && !q && !category ? (
            <Link className="button button-outline" to="/imports">
              录入衣服
            </Link>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                if (onlySelected) setOnlySelected(false)
                else {
                  setParams(
                    group === 'washing' && !q && !category
                      ? { group: 'available' }
                      : q || category
                        ? { group }
                        : { group: 'all' },
                    { replace: true },
                  )
                  if (
                    group === 'washing' &&
                    !q &&
                    !category &&
                    !draft.selected.length &&
                    !operation.busy
                  )
                    update({ ...draft, action: 'mark_washing' })
                }
              }}
            >
              {onlySelected
                ? '回到清单选择'
                : q || category
                  ? '清除筛选'
                  : group === 'washing'
                    ? '选择可穿单品'
                    : '查看全部单品'}
            </Button>
          )}
        </div>
      )}
      {!onlySelected && list.hasNextPage && (
        <Button
          variant="outline"
          disabled={list.isFetching}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetching ? '正在读取…' : '加载更多单品'}
        </Button>
      )}
      {!onlySelected && list.isSuccess && (
        <p className="care-help">
          已载入 {rows.length} 件{list.hasNextPage ? '，还有更多单品' : ''}
        </p>
      )}
    </div>
  )
}
