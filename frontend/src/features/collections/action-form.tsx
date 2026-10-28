import { useEffect, useId } from 'react'
import { useForm } from 'react-hook-form'
import type { Revision } from '../outfits'
import { SheetFooter } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import type { OperationController } from '../../lib/use-operation'
import { today, type Favorite, type Wear, type History } from './api'
import { RecordPreview } from './preview'

export type RecordAction = { revision: Revision } & (
  | { kind: 'favorite'; favorite?: Favorite }
  | { kind: 'wear'; wear?: Wear; date?: string }
  | { kind: 'remove-favorite'; favorite: Favorite }
  | { kind: 'remove-wear'; wear: Wear }
  | { kind: 'remove-history'; history: History }
  | { kind: 'reuse' }
)
export const actionTitle = (action: RecordAction) =>
  ({
    favorite: action.kind === 'favorite' && action.favorite ? '修改收藏名称' : '收藏这套',
    wear: action.kind === 'wear' && action.wear ? '编辑穿着记录' : '记录穿着',
    'remove-favorite': '取消收藏',
    'remove-wear': '删除穿着记录',
    'remove-history': '从历史移除',
    reuse: '以这套为基础搭配',
  })[action.kind]

export function RecordActionForm({
  action,
  op,
  onDirty,
}: {
  action: RecordAction
  op: OperationController
  onDirty: (dirty: boolean) => void
}) {
  const formId = useId()
  const favorite = action.kind === 'favorite' ? action.favorite : undefined
  const wear = action.kind === 'wear' ? action.wear : undefined
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isDirty, dirtyFields },
  } = useForm({
    defaultValues: {
      name: favorite?.name ?? '',
      date: wear?.worn_on ?? (action.kind === 'wear' ? action.date : undefined) ?? today(),
      notes: wear?.notes ?? '',
    },
  })
  // Only explicitly refreshed server fields replace untouched inputs; edited fields survive.
  useEffect(() => {
    reset(
      {
        name: favorite?.name ?? '',
        date: wear?.worn_on ?? (action.kind === 'wear' ? action.date : undefined) ?? today(),
        notes: wear?.notes ?? '',
      },
      { keepDirtyValues: true },
    )
  }, [favorite?.version, wear?.version, reset])
  void dirtyFields
  useEffect(() => {
    onDirty(isDirty)
    return () => onDirty(false)
  }, [isDirty, onDirty])
  const date = watch('date')
  const edit = !!favorite || !!wear
  const destructive = action.kind.startsWith('remove-')
  const submit = handleSubmit((values) => {
    switch (action.kind) {
      case 'favorite':
        if (favorite)
          op.send(`/favorites/${favorite.id}`, 'PATCH', {
            expected_version: favorite.version,
            name: values.name.trim(),
          })
        else
          op.send('/favorites', 'POST', {
            revision_id: action.revision.id,
            name: values.name.trim(),
          })
        break
      case 'wear':
        if (!values.date || values.date > today()) return
        if (wear)
          op.send(`/wear-records/${wear.id}`, 'PATCH', {
            expected_version: wear.version,
            worn_on: values.date,
            notes: values.notes,
          })
        else
          op.send('/wear-records', 'POST', {
            revision_id: action.revision.id,
            worn_on: values.date,
            notes: values.notes,
          })
        break
      case 'remove-favorite':
        op.send(`/favorites/${action.favorite.id}`, 'DELETE', undefined, action.favorite.version)
        break
      case 'remove-wear':
        op.send(`/wear-records/${action.wear.id}`, 'DELETE', undefined, action.wear.version)
        break
      case 'remove-history':
        op.send(
          `/outfit-revisions/${action.revision.id}`,
          'DELETE',
          undefined,
          action.history.version,
        )
        break
      case 'reuse':
        op.send('/outfit-sessions', 'POST', { base_revision_id: action.revision.id })
        break
    }
  })
  return (
    <form id={formId} className="record-action-form" onSubmit={submit}>
      <RecordPreview revision={action.revision} />
      {action.kind === 'favorite' && (
        <>
          <p className="muted">收藏留住这套搭配，不会自动记录为穿过。</p>
          <label>
            收藏名称（选填）
            <input
              {...register('name')}
              maxLength={100}
              disabled={op.busy}
              placeholder="例如：轻松通勤"
            />
          </label>
        </>
      )}
      {action.kind === 'wear' && (
        <>
          <p className="muted">记录实际穿过的日期；同一天可以记录不同搭配。</p>
          <label>
            实际穿着日期
            <input {...register('date')} type="date" required max={today()} disabled={op.busy} />
          </label>
          <label>
            穿着备注（选填）
            <textarea
              {...register('notes')}
              maxLength={1000}
              disabled={op.busy}
              placeholder="穿起来的感受，或当天的小记"
            />
          </label>
          {date > today() && (
            <p className="error" role="alert">
              实际穿着不能选择未来日期。
            </p>
          )}
        </>
      )}
      {action.kind === 'remove-history' && (
        <p>
          只从历史列表移除，收藏、穿着记录和原始快照仍保留。如果这是当前选中的搭配，该选择也会清空，不会自动生成替代。
        </p>
      )}
      {action.kind === 'remove-favorite' && <p>取消收藏后，搭配历史和穿着记录仍会保留。</p>}
      {action.kind === 'remove-wear' && (
        <p>删除 {action.wear.worn_on} 的这条穿着记录，搭配历史和收藏仍会保留。</p>
      )}
      {action.kind === 'reuse' && (
        <p>
          将这套搭配带入新的搭配页面，并检查衣服当前是否可用。旧记录保持不变；此操作不会生成新搭配，也不会自动锁定单品。
        </p>
      )}
      <SheetFooter>
        <Button
          form={formId}
          type="submit"
          className={destructive ? 'button-danger' : ''}
          disabled={
            op.busy || (edit && !isDirty) || (action.kind === 'wear' && (!date || date > today()))
          }
        >
          {op.sending
            ? '正在保存…'
            : destructive
              ? `确认${actionTitle(action)}`
              : action.kind === 'reuse'
                ? '继续搭配'
                : edit
                  ? '保存修改'
                  : action.kind === 'favorite'
                    ? '确认收藏'
                    : '确认记录穿着'}
        </Button>
      </SheetFooter>
    </form>
  )
}
