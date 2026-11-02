import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { SheetFooter } from '../../../components/ui/sheet'
import { entityId } from '../../../lib/id'
import { GarmentImage } from '../image'
import { changeConcern, changePreview } from './preview'
import { getGarment, type Garment } from '../api'
import { actions, type CareBatch } from './api'
import { status, type CareDraft } from './state'

export function CareConfirmation({
  draft,
  tags,
  busy,
  onConfirm,
}: {
  draft: CareDraft
  tags: { id: string; name: string }[]
  busy: boolean
  onConfirm: (payload: CareBatch, selected: Garment[]) => void
}) {
  const query = useQuery({
    queryKey: ['care-confirm', draft.selected.map((g) => g.id)],
    queryFn: () =>
      Promise.all(
        draft.selected.map(async (g) => {
          try {
            return await getGarment(g.id)
          } catch (error) {
            throw new Error(
              `${g.name || '未命名单品'}：${error instanceof Error ? error.message : '无法读取，请重试'}`,
            )
          }
        }),
      ),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
  const items = query.data
  const concerns = items?.filter((g) => changeConcern(g, draft)).length ?? 0
  const extra = draft.action.startsWith('tags_')
    ? draft.tag_ids.map((id) => tags.find((t) => t.id === id)?.name ?? '标签已失效').join('、')
    : draft.action === 'location_set'
      ? draft.location.trim()
      : ''
  return (
    <div className="care-confirm">
      <p className="notice">
        <strong>{actions[draft.action]}</strong>
        {extra && `：${extra}`}
        <br />
        仅处理下面明确选中的 {draft.selected.length} 件，逐件校验并显示结果。
      </p>
      {query.isFetching && <p role="status">正在重新核对所选单品…</p>}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}。请重试，或返回已选列表移除失效单品。</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            重新核对
          </Button>
        </div>
      )}
      {!query.isFetching && !query.isError && concerns > 0 && (
        <p className="care-conflict-note" role="status">
          其中 {concerns} 件当前无法执行，将保留原状态并返回原因；可关闭面板调整选择。
        </p>
      )}
      {!query.isFetching && !query.isError && items && (
        <ul className="care-confirm-items">
          {items.map((g) => (
            <li key={g.id} className="care-confirm-item">
              <GarmentImage className="care-confirm-image" src={g.image_url} alt="" retry={false} />
              <div>
                <strong>{g.name || '未命名单品'}</strong>
                <span>
                  {status(g)} · 位置：{g.lifecycle.location || '未填写'}
                </span>
                <p className="care-change-preview">{changePreview(g, draft)}</p>
                {changeConcern(g, draft) && (
                  <p className="care-conflict-note">{changeConcern(g, draft)}</p>
                )}
                {g.version !== draft.selected.find((s) => s.id === g.id)?.version && (
                  <small>资料已更新，本次按以上最新状态确认。</small>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">发生冲突的单品保持原样；成功项不会在后续重试中再次处理。</p>
      <SheetFooter>
        <Button
          disabled={busy || query.isFetching || query.isError || !items?.length}
          onClick={() => {
            if (!items || query.isFetching || query.isError) return
            onConfirm(
              {
                items: items.map((g) => ({
                  id: entityId(),
                  garment_id: g.id,
                  expected_version: g.version,
                  action: draft.action,
                  tag_ids: draft.action.startsWith('tags_') ? draft.tag_ids : [],
                  location: draft.action === 'location_set' ? draft.location.trim() : null,
                })),
              },
              items,
            )
          }}
        >
          确认对 {draft.selected.length} 件执行
        </Button>
      </SheetFooter>
    </div>
  )
}
