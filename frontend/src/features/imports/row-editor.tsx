import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AttributeForm, type Attributes } from '../wardrobe'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { rowSchema, type ImportRow } from './api'

export function RowEditor({
  batchId,
  row,
  onClose,
}: {
  batchId: string
  row: ImportRow
  onClose: () => void
}) {
  // Keep the opening revision with the form. Polling must never overwrite unsaved input.
  const container = useRef<HTMLElement>(null)
  useEffect(() => {
    container.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  const [snapshot, setSnapshot] = useState(row)
  const [draft, setDraft] = useState<Partial<Attributes>>({})
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (changes: Partial<Attributes>) => {
      setDraft(changes)
      return api(`/imports/${batchId}/rows/${row.id}`, rowSchema, {
        method: 'PATCH',
        body: JSON.stringify({ expected_version: snapshot.version, changes }),
      })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['import', batchId] })
      onClose()
    },
  })
  return (
    <section
      ref={container}
      className="panel row-editor"
      aria-label={`编辑第 ${row.row_number} 行`}
    >
      <div className="section-heading">
        <h2>第 {row.row_number} 行 · 修改属性</h2>
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
          关闭编辑
        </Button>
      </div>
      <p>空白表示未知。保存人工修改后再确认入库；即使清空某个属性，后续识别也不会覆盖它。</p>
      {mutation.error && (
        <div role="alert" className="error">
          <p>{mutation.error.message}</p>
          {row.version !== snapshot.version && (
            <>
              <p>
                后台版本已更新。草稿仍在，点击下方按钮将保留你的修改并读取其他最新属性，然后再次保存。
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSnapshot({ ...row, draft: { ...row.draft, ...draft } })
                  mutation.reset()
                }}
              >
                保留草稿并读取新版本
              </Button>
            </>
          )}
        </div>
      )}
      <AttributeForm
        key={snapshot.version}
        initial={snapshot.draft}
        hasCutout={row.has_cutout}
        busy={mutation.isPending}
        onSave={(changes) => mutation.mutate({ ...draft, ...changes })}
      />
    </section>
  )
}
