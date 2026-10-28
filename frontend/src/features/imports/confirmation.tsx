import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { confirmationSchema, getBatch, type ImportRow } from './api'

const pendingSchema = z.object({
  key: z.string(),
  payload: z.object({ rows: z.array(z.object({ row_id: z.uuid(), expected_version: z.int() })) }),
})
export function useConfirmation(batchId: string, rows: ImportRow[], onSuccess: () => void) {
  const key = `wardrobe.confirm.${batchId}`
  const client = useQueryClient()
  const [pending, setPending] = useState<z.infer<typeof pendingSchema> | null>(() => {
    try {
      return pendingSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
    } catch {
      return null
    }
  })
  const [review, setReview] = useState<ImportRow[] | null>(null)
  const [discard, setDiscard] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: async (operation: z.infer<typeof pendingSchema>) => {
      setPending(operation)
      localStorage.setItem(key, JSON.stringify(operation))
      return api(`/imports/${batchId}/confirm`, confirmationSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': operation.key },
        body: JSON.stringify(operation.payload),
      })
    },
    onSuccess: () => {
      localStorage.removeItem(key)
      setPending(null)
      setReview(null)
      onSuccess()
    },
  })
  const targets =
    pending?.payload.rows
      .map((item) => rows.find((row) => row.id === item.row_id))
      .filter((row): row is ImportRow => !!row) ?? []
  return {
    blocked: !!pending || mutation.isPending || refreshing,
    sending: mutation.isPending,
    result: mutation.data,
    open: (next: ImportRow[]) => {
      if (!pending && next.length) {
        setError('')
        setReview(next)
      }
    },
    feedback: pending && (
      <div className="notice" role="status">
        <strong>上次入库结果尚未确认 · {pending.payload.rows.length} 件</strong>
        <p>
          待确认对象：
          {targets
            .map((row) => `第 ${row.row_number} 行 ${row.draft.name || row.filename}`)
            .join('、') || '原请求中的单品'}
          。重试只发送原请求，不能改成当前新选择。
        </p>
        {mutation.error && (
          <p role="alert" className="error">
            {mutation.error.message}
          </p>
        )}
        <div className="actions">
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate(pending)}>
            重试上次确认
          </Button>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => setDiscard(true)}>
            读取最新结果
          </Button>
        </div>
      </div>
    ),
    panels: (
      <>
        <Sheet
          title={`确认将 ${review?.length ?? 0} 件加入衣橱？`}
          trigger={<span hidden />}
          open={!!review && !pending}
          onOpenChange={(open) => {
            if (!open) setReview(null)
          }}
        >
          <p>请确认图片和品类已核对。其他属性可留空，入库后仍可在衣橱中编辑。</p>
          <ul className="import-confirm-list">
            {review?.map((row) => (
              <li key={row.id}>
                {row.image_url && <img src={row.image_url} alt="" />}
                <span>
                  第 {row.row_number} 行 · {row.draft.name || row.filename}
                </span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button variant="outline" onClick={() => setReview(null)}>
              继续核对
            </Button>
            <Button
              onClick={() => {
                if (!review || pending) return
                const valid = review.every((item) =>
                  rows.some(
                    (row) =>
                      row.id === item.id &&
                      row.version === item.version &&
                      row.row_status === 'ready',
                  ),
                )
                if (!valid) {
                  setError('选中内容已更新，请关闭面板后重新核对。')
                  return
                }
                mutation.mutate({
                  key: operationId(),
                  payload: {
                    rows: review.map((row) => ({ row_id: row.id, expected_version: row.version })),
                  },
                })
              }}
            >
              确认入库
            </Button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Sheet>
        <Sheet
          title="读取最新入库结果？"
          trigger={<span hidden />}
          open={discard}
          onOpenChange={(open) => {
            if (!refreshing) setDiscard(open)
          }}
        >
          <p>
            原请求可能已经完成。成功读取后会放弃原请求重试，保留已入库的单品；请重新核对剩余项。
          </p>
          <Button
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              try {
                const batch = await getBatch(batchId)
                client.setQueryData(['import', batchId], batch)
                localStorage.removeItem(key)
                setPending(null)
                setReview(null)
                setDiscard(false)
                mutation.reset()
                onSuccess()
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : '读取失败')
              } finally {
                setRefreshing(false)
              }
            }}
          >
            {refreshing ? '正在读取…' : '确认读取最新结果'}
          </Button>
          {error && <p role="alert">{error}</p>}
        </Sheet>
      </>
    ),
  }
}
