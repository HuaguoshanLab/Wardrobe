import './workflow.css'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { PageHeader } from '../../components/ui/page-header'
import { api } from '../../lib/http'
import { operationId } from '../../lib/id'
import { getBatch, batchPollInterval, acceptedSchema, rowSchema, type ImportRow } from './api'
import { getTaxonomy } from '../wardrobe'
import { RowEditor } from './row-editor'
import { ReviewRow } from './review-row'
import { useConfirmation } from './confirmation'

type Filter = 'pending' | 'invalid' | 'confirmed' | 'all'
export function ReviewPage() {
  const { id } = useParams()
  return <ReviewBatch key={id} id={id!} />
}
function ReviewBatch({ id }: { id: string }) {
  const client = useQueryClient()
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportRow | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [actionTarget, setActionTarget] = useState<{ row: ImportRow; step: string } | null>(null)
  const query = useQuery({
    queryKey: ['import', id],
    queryFn: () => getBatch(id),
    refetchInterval: (query) => batchPollInterval(query.state.data),
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['import', id] })
    void client.invalidateQueries({ queryKey: ['garments'] })
  }
  const confirm = useConfirmation(id, query.data?.rows ?? [], () => {
    setSelected([])
    refresh()
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
    onSuccess: () => {
      setActionTarget(null)
      refresh()
    },
  })
  if (!query.data)
    return (
      <section>
        <PageHeader title="审核衣服" backTo="/imports" backLabel="返回录入入口" />
        <div className="panel">
          <p role={query.isError ? 'alert' : 'status'}>
            {query.error?.message ?? '正在读取本批衣服…'}
          </p>
          {query.isError && <Button onClick={() => void query.refetch()}>重新读取</Button>}
        </div>
      </section>
    )
  const batch = query.data
  const counts = {
    ready: batch.rows.filter((row) => row.row_status === 'ready').length,
    invalid: batch.rows.filter((row) => row.row_status === 'invalid').length,
    confirmed: batch.rows.filter((row) => row.row_status === 'confirmed').length,
    skipped: batch.rows.filter((row) => row.row_status === 'skipped').length,
  }
  const processing = !!batchPollInterval(batch)
  const complete = !!batch.rows.length && counts.ready + counts.invalid === 0 && !processing
  const visible = batch.rows.filter(
    (row) =>
      filter === 'all' ||
      (filter === 'pending' && ['ready', 'invalid'].includes(row.row_status)) ||
      row.row_status === filter,
  )
  const selectedRows = batch.rows.filter(
    (row) => selected.includes(row.id) && row.row_status === 'ready',
  )
  const readyVisible = visible.filter((row) => row.row_status === 'ready')
  const active = batch.rows.find((row) => row.id === editing)
  const next =
    active &&
    batch.rows
      .slice(batch.rows.indexOf(active) + 1)
      .find((row) => !['confirmed', 'skipped'].includes(row.row_status))
  const busy = confirm.blocked || action.isPending
  return (
    <section className="import-review">
      <PageHeader title="审核衣服" backTo="/imports" backLabel="返回录入入口" />
      <p className="muted">
        {batch.source === 'photos' ? '照片' : 'Excel'}导入 · 只有确认的单品才会加入衣橱
      </p>
      <div className="import-overview">
        <div>
          <strong>{batch.rows.length}</strong>
          <span>本批件数</span>
        </div>
        <div>
          <strong>{counts.ready}</strong>
          <span>待确认</span>
        </div>
        <div>
          <strong>{counts.invalid}</strong>
          <span>需处理</span>
        </div>
        <div>
          <strong>{counts.confirmed}</strong>
          <span>已入库</span>
        </div>
      </div>
      {processing && (
        <p className="notice" role="status">
          正在处理图片与属性。已就绪的单品可先核对，刷新不会重复识别。
        </p>
      )}
      {batch.job_error && (
        <p role="alert" className="error">
          {batch.job_error}。已有单品仍可核对；源文件问题请修正后重新上传。
        </p>
      )}
      {query.isError && (
        <div className="notice">
          <p role="alert">进度读取失败，当前为上次结果。</p>
          <Button onClick={() => void query.refetch()}>重试读取</Button>
        </div>
      )}
      {complete && (
        <div className="panel import-complete">
          <h2>本批已处理完毕</h2>
          <p>
            已入库 {counts.confirmed} 件，已移除 {counts.skipped} 件。
          </p>
          <div className="actions">
            <Link className="button" to="/wardrobe">
              查看衣橱
            </Link>
            <Link className="button button-outline" to="/imports">
              继续录入
            </Link>
          </div>
        </div>
      )}
      {confirm.feedback}
      {confirm.result && (
        <div className="notice" role="status">
          <p>
            本次确认：
            {
              confirm.result.rows.filter((row) =>
                ['confirmed', 'already_confirmed'].includes(row.status),
              ).length
            }{' '}
            件已入库。
          </p>
          {confirm.result.rows
            .filter((row) => ['invalid', 'version_conflict'].includes(row.status))
            .map((row) => (
              <p key={row.row_id}>
                第 {batch.rows.find((item) => item.id === row.row_id)?.row_number} 行：
                {row.status === 'version_conflict'
                  ? '内容已更新，请重新核对'
                  : row.errors.join('；')}
              </p>
            ))}
        </div>
      )}
      <div className="import-filters" role="group" aria-label="审核状态筛选">
        {(
          [
            ['pending', '待审核'],
            ['invalid', '需处理'],
            ['confirmed', '已入库'],
            ['all', '全部'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>
      {!visible.length ? (
        <div className="panel">
          <p>
            {processing
              ? '正在准备审核内容…'
              : filter === 'pending'
                ? '没有待审核单品。'
                : '此分类暂无单品。'}
          </p>
          <Button variant="outline" onClick={() => setFilter('all')}>
            查看全部
          </Button>
          {!batch.rows.length && !processing && (
            <Link className="text-link" to="/imports">
              修正文件后重新上传
            </Link>
          )}
        </div>
      ) : (
        <div className="review-table-wrap">
          <table className="review-table">
            <thead>
              <tr>
                <th>选择 / 行号</th>
                <th>图片</th>
                <th>单品</th>
                <th>审核状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <ReviewRow
                  key={row.id}
                  row={row}
                  fields={taxonomy.data?.fields ?? {}}
                  selected={selectedRows.some((item) => item.id === row.id)}
                  busy={busy}
                  onSelect={(checked) =>
                    setSelected(
                      checked
                        ? [...selected, row.id]
                        : selected.filter((value) => value !== row.id),
                    )
                  }
                  onPreview={() => setPreview(row)}
                  onEdit={() => setEditing(row.id)}
                  onConfirm={() => confirm.open([row])}
                  onAction={(step) => {
                    action.reset()
                    setActionTarget({ row, step })
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!complete && (
        <div className="import-confirm-bar">
          <Button
            variant="outline"
            disabled={busy || !readyVisible.length}
            onClick={() => setSelected(readyVisible.map((row) => row.id))}
          >
            选择本页待确认
          </Button>
          {selectedRows.length > 0 && (
            <button className="text-link" disabled={busy} onClick={() => setSelected([])}>
              取消选择
            </button>
          )}
          <Button
            disabled={busy || !selectedRows.length}
            onClick={() => confirm.open(selectedRows)}
          >
            确认选中（{selectedRows.length}）
          </Button>
        </div>
      )}
      <details className="import-help">
        <summary>审核与识别说明</summary>
        <p>
          图片和品类必填，其他属性可未知。识别或去背景失败不阻止有效单品入库。Excel
          原有属性不会被自动识别覆盖；AI 预填需要人工核对，材质、厚度和保暖性请按实际填写。
        </p>
      </details>
      {active && (
        <RowEditor
          key={active.id}
          batchId={id}
          row={active}
          onNext={next ? () => setEditing(next.id) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      <Sheet
        title={preview?.draft.name || '单品图片'}
        trigger={<span hidden />}
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        {preview?.image_url && (
          <img
            className="import-preview-large"
            src={preview.image_url}
            alt={preview.draft.name || preview.filename}
          />
        )}
      </Sheet>
      {confirm.panels}
      <Sheet
        title={actionTarget?.step === 'skip' ? '移除此行？' : '重试处理？'}
        trigger={<span hidden />}
        open={!!actionTarget}
        onOpenChange={(open) => {
          if (!open && !action.isPending) setActionTarget(null)
        }}
      >
        <p>
          第 {actionTarget?.row.row_number} 行 ·{' '}
          {actionTarget?.row.draft.name || actionTarget?.row.filename}
        </p>
        <p>
          {actionTarget?.step === 'skip'
            ? '此行将从本批审核中移除，不会加入衣橱。已入库的其他单品不受影响。'
            : actionTarget?.step === 'analysis'
              ? '再次识别可能产生新的模型费用；人工修改过的属性仍会保留。'
              : '仅重试这个处理步骤，已完成的其他步骤保留。'}
        </p>
        {action.error && (
          <p role="alert" className="error">
            {action.error.message}
          </p>
        )}
        <div className="actions">
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => setActionTarget(null)}
          >
            暂不操作
          </Button>
          <Button
            disabled={action.isPending}
            onClick={() => actionTarget && action.mutate(actionTarget)}
          >
            {action.isPending
              ? '正在提交…'
              : actionTarget?.step === 'skip'
                ? '确认移除'
                : '确认重试'}
          </Button>
        </div>
      </Sheet>
    </section>
  )
}
