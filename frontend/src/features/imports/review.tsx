import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import {
  getBatch,
  batchPollInterval,
  terminal,
  statusLabel,
  confirmationSchema,
  acceptedSchema,
  rowSchema,
  type ImportRow,
} from './api'
import { getTaxonomy } from '../wardrobe'
import { RowEditor } from './row-editor'

export function ReviewPage() {
  const { id } = useParams()
  const client = useQueryClient()
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['import', id],
    queryFn: () => getBatch(id!),
    refetchInterval: (query) => batchPollInterval(query.state.data),
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['import', id] })
    void client.invalidateQueries({ queryKey: ['garments'] })
  }
  const confirm = useMutation({
    mutationFn: async (rows: ImportRow[]) => {
      const payload = {
        rows: rows.map((row) => ({ row_id: row.id, expected_version: row.version })),
      }
      const storageKey = `wardrobe.confirm.${id}`
      const saved = localStorage.getItem(storageKey)
      const old = saved ? (JSON.parse(saved) as { key: string; payload: typeof payload }) : null
      // A failed transport always retries the original request, even if a poll changed versions.
      const operation = old ?? { key: operationId(), payload }
      localStorage.setItem(storageKey, JSON.stringify(operation))
      const result = await api(`/imports/${id}/confirm`, confirmationSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': operation.key },
        body: JSON.stringify(operation.payload),
      })
      localStorage.removeItem(storageKey)
      return result
    },
    onSuccess: () => {
      setSelected([])
      refresh()
    },
  })
  const action = useMutation({
    mutationFn: async ({ row, step }: { row: ImportRow; step: string }) => {
      if (step === 'skip')
        return api(`/imports/${id}/rows/${row.id}`, rowSchema, {
          method: 'PATCH',
          body: JSON.stringify({ expected_version: row.version, changes: {}, skip: true }),
        })
      const storageKey = `wardrobe.retry.${row.id}.${step}`
      const key = localStorage.getItem(storageKey) ?? operationId()
      localStorage.setItem(storageKey, key)
      const result = await api(`/imports/${id}/rows/${row.id}/retry`, acceptedSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ step }),
      })
      localStorage.removeItem(storageKey)
      return result
    },
    onSuccess: refresh,
  })
  if (query.isPending) return <p>正在载入审核表格…</p>
  if (query.error || !query.data)
    return (
      <p role="alert" className="error">
        {query.error?.message ?? '批次不存在'}
      </p>
    )
  const batch = query.data
  const active = batch.rows.find((row) => row.id === editing)
  const selectable = batch.rows.filter((row) => row.row_status === 'ready')
  const busy = confirm.isPending || action.isPending
  return (
    <>
      <Link className="text-link" to="/imports">
        ← 返回录入入口
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REVIEW BEFORE YOU KEEP</span>
          <h1>逐行审核</h1>
          <p>
            {batch.source === 'photos' ? '照片' : 'Excel'}导入 · {batch.rows.length} 行 ·{' '}
            {statusLabel[batch.job_status] ?? batch.job_status}
          </p>
        </div>
        <Link className="text-link" to="/wardrobe">
          查看衣橱 →
        </Link>
      </div>
      <div className="notice">
        图片和品类必填。转换成功即可手工确认；识别或去背景失败不会阻止有效行入库。
        {batch.source === 'photos' && '标注 Fake 的结果是模拟预填，请核对。'}
        刷新页面只读取进度，不会重新识别。AI
        预填需要核对，材质、厚度和保暖性请手工补充；重试识别可能再次计费。
      </div>
      {batch.job_error && (
        <p className="error" role="alert">
          {batch.job_error}。已有行可继续审核或重试；没有审核行时，请修正文件后重新上传。
        </p>
      )}
      {(confirm.error || action.error) && (
        <p role="alert" className="error">
          {(confirm.error || action.error)?.message}
        </p>
      )}
      {confirm.data && (
        <div role="status" className="notice">
          本次入库 / 已入库{' '}
          {
            confirm.data.rows.filter((r) => ['confirmed', 'already_confirmed'].includes(r.status))
              .length
          }{' '}
          行。
          {confirm.data.rows
            .filter((r) => ['invalid', 'version_conflict'].includes(r.status))
            .map((r) => (
              <p key={r.row_id}>
                第 {batch.rows.find((row) => row.id === r.row_id)?.row_number ?? '?'} 行：
                {r.status === 'version_conflict'
                  ? '数据已更新，请核对后重新确认'
                  : r.errors.join('；')}
              </p>
            ))}
        </div>
      )}
      <div className="actions review-actions">
        <Button
          variant="outline"
          disabled={!selectable.length || busy}
          onClick={() => setSelected(selectable.map((r) => r.id))}
        >
          选择所有有效行
        </Button>
        <Button
          disabled={!selected.length || busy}
          onClick={() => confirm.mutate(batch.rows.filter((r) => selected.includes(r.id)))}
        >
          确认选中（{selected.length}）
        </Button>
        {confirm.isError && (
          <Button variant="outline" onClick={() => confirm.mutate([])}>
            重试上次确认
          </Button>
        )}
      </div>
      {batch.rows.length === 0 && (
        <section className="panel">
          <p>
            {terminal.has(batch.job_status)
              ? '暂无可审核行，请检查模板后重新上传。'
              : '正在解析文件，请稍候…'}
          </p>
        </section>
      )}
      <div className="review-table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th>选择 / 行号</th>
              <th>图片</th>
              <th>名称与品类</th>
              <th>处理与校验</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row) => {
              const finalized = ['confirmed', 'skipped'].includes(row.row_status)
              return (
                <tr key={row.id}>
                  <td>
                    <label>
                      <input
                        aria-label={`选择第 ${row.row_number} 行`}
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        disabled={row.row_status !== 'ready' || busy}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, row.id]
                              : selected.filter((x) => x !== row.id),
                          )
                        }
                      />
                      第 {row.row_number} 行
                    </label>
                  </td>
                  <td>
                    {row.image_url ? (
                      <img
                        className="row-image"
                        src={row.image_url}
                        alt={`第 ${row.row_number} 行图片`}
                      />
                    ) : (
                      <span>暂无可用图片</span>
                    )}
                  </td>
                  <td>
                    <strong>{row.draft.name || row.filename}</strong>
                    <p>
                      {taxonomy.data?.fields.category[row.draft.category ?? ''] ??
                        row.draft.category ??
                        '品类未填写'}
                      {row.analysis_source === 'fake' && <span className="badge">Fake 预填</span>}
                      {row.analysis_source === 'qwen' && (
                        <span className="badge">千问预填 · 待核对</span>
                      )}
                    </p>
                    {row.analysis_notes.map((note, index) => (
                      <p key={index}>{note}</p>
                    ))}
                    <small>
                      {row.draft.seasons
                        .map((s) => taxonomy.data?.fields.seasons[s] ?? s)
                        .join(' / ') || '季节未知'}{' '}
                      · {row.draft.availability === 'available' ? '可穿' : '暂不可用'}
                    </small>
                  </td>
                  <td>
                    <strong>{statusLabel[row.row_status]}</strong>
                    <p className="step-status">
                      转换：{statusLabel[row.conversion_status]}
                      <br />
                      识别：{statusLabel[row.analysis_status]}
                      <br />
                      去背景：{statusLabel[row.cutout_status]}
                    </p>
                    {row.validation_errors.map((error, i) => (
                      <p className="error" key={i}>
                        {error}
                      </p>
                    ))}
                    {Object.entries(row.processing_errors)
                      .filter(([key]) => ['conversion', 'analysis', 'cutout'].includes(key))
                      .map(([key, error]) => (
                        <p className="error" key={key}>
                          {String(error)}
                        </p>
                      ))}
                  </td>
                  <td>
                    <div className="row-actions">
                      {!finalized && (
                        <>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setEditing(row.id)}
                          >
                            修改属性
                          </Button>
                          <Button
                            disabled={row.row_status !== 'ready' || busy}
                            onClick={() => confirm.mutate([row])}
                          >
                            确认入库
                          </Button>
                          {(['conversion', 'analysis', 'cutout'] as const)
                            .filter((step) =>
                              ['failed', 'interrupted', 'cancelled'].includes(
                                row[`${step}_status`],
                              ),
                            )
                            .map((step) => (
                              <Button
                                key={step}
                                variant="outline"
                                disabled={busy}
                                onClick={() => action.mutate({ row, step })}
                              >
                                重试
                                {step === 'conversion'
                                  ? '转换'
                                  : step === 'analysis'
                                    ? '识别'
                                    : '去背景'}
                              </Button>
                            ))}
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => action.mutate({ row, step: 'skip' })}
                          >
                            移除此行
                          </Button>
                        </>
                      )}
                      {row.confirmed_garment_id && (
                        <Link className="text-link" to={`/wardrobe/${row.confirmed_garment_id}`}>
                          查看单品
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {active && !['confirmed', 'skipped'].includes(active.row_status) && (
        <RowEditor
          key={active.id}
          batchId={batch.id}
          row={active}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
