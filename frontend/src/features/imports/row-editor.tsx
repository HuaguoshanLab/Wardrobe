import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GarmentEditor, type Attributes } from '../wardrobe'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { api } from '../../lib/http'
import { rowSchema, getBatch, type ImportRow } from './api'
import { LeaveGuard } from './leave-guard'

export function RowEditor({
  batchId,
  row,
  onClose,
  onNext,
}: {
  batchId: string
  row: ImportRow
  onNext?: () => void
  onClose: () => void
}) {
  const [advance, setAdvance] = useState(false)
  const [snapshot, setSnapshot] = useState(row)
  const [changes, setChanges] = useState<Partial<Attributes>>({})
  const [discard, setDiscard] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: () =>
      api(`/imports/${batchId}/rows/${row.id}`, rowSchema, {
        method: 'PATCH',
        body: JSON.stringify({ expected_version: snapshot.version, changes }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['import', batchId] })
      if (advance && onNext) onNext()
      else onClose()
    },
  })
  const close = () => {
    if (mutation.isPending || refreshing) return
    if (Object.keys(changes).length) setDiscard(true)
    else onClose()
  }
  return (
    <>
      <Sheet
        title={`第 ${row.row_number} 行 · 修改属性`}
        trigger={<span hidden />}
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <div className="import-editor-preview">
          {row.image_url ? (
            <img src={row.image_url} alt={snapshot.draft.name || row.filename} />
          ) : (
            <span>暂无可用图片</span>
          )}
          <p>
            {snapshot.draft.name || row.filename}
            <small>保存属性后，再确认入库。人工修改不会被后续识别覆盖。</small>
          </p>
        </div>
        {mutation.error && (
          <div className="notice">
            <p role="alert" className="error">
              {mutation.error.message}
            </p>
            <Button
              variant="outline"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true)
                try {
                  const batch = await getBatch(batchId)
                  const latest = batch.rows.find((item) => item.id === row.id)
                  if (!latest || ['confirmed', 'skipped'].includes(latest.row_status))
                    throw new Error('这件单品已入库或移除，请关闭编辑查看最新结果')
                  setSnapshot(latest)
                  client.setQueryData(['import', batchId], batch)
                  mutation.reset()
                } catch (reason) {
                  setRefreshError(reason instanceof Error ? reason.message : '读取失败')
                } finally {
                  setRefreshing(false)
                }
              }}
            >
              保留草稿并读取新版本
            </Button>
          </div>
        )}
        {refreshError && (
          <p role="alert" className="error">
            {refreshError}
          </p>
        )}
        <GarmentEditor
          initial={snapshot.draft}
          changes={changes}
          onChange={setChanges}
          busy={mutation.isPending || refreshing}
          onSave={() => mutation.mutate()}
          onCancel={close}
        >
          <div className="attribute-grid import-editor-options">
            <label>
              状态
              <select
                disabled={mutation.isPending || refreshing}
                value={changes.availability ?? snapshot.draft.availability}
                onChange={(event) =>
                  setChanges({
                    ...changes,
                    availability: event.target.value as Attributes['availability'],
                  })
                }
              >
                <option value="available">可穿</option>
                <option value="unavailable">暂不可用</option>
              </select>
            </label>
            <label>
              展示图片
              <select
                disabled={mutation.isPending || refreshing}
                value={changes.display_variant ?? snapshot.draft.display_variant}
                onChange={(event) =>
                  setChanges({
                    ...changes,
                    display_variant: event.target.value as Attributes['display_variant'],
                  })
                }
              >
                <option value="original">原图视图</option>
                <option value="cutout" disabled={!row.has_cutout}>
                  去背景图{!row.has_cutout && '（尚不可用）'}
                </option>
              </select>
            </label>
          </div>
          {onNext && (
            <label className="import-next">
              <input
                type="checkbox"
                checked={advance}
                onChange={(event) => setAdvance(event.target.checked)}
              />
              保存后编辑下一件
            </label>
          )}
        </GarmentEditor>
      </Sheet>
      <Sheet
        title="放弃未保存的修改？"
        trigger={<span hidden />}
        open={discard}
        onOpenChange={setDiscard}
      >
        <p>这件单品的修改尚未保存。</p>
        <div className="actions">
          <Button onClick={() => setDiscard(false)}>继续编辑</Button>
          <Button variant="outline" onClick={onClose}>
            放弃修改
          </Button>
        </div>
      </Sheet>
      <LeaveGuard dirty={Object.keys(changes).length > 0} busy={mutation.isPending || refreshing} />
    </>
  )
}
