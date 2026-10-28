import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { statusLabel, type ImportRow } from './api'

export function needsSourceFix(row: ImportRow) {
  return !row.image_asset_id && row.conversion_status === 'failed'
}
export function ReviewRow({
  row,
  fields,
  selected,
  busy,
  onSelect,
  onEdit,
  onPreview,
  onConfirm,
  onAction,
}: {
  row: ImportRow
  fields: Record<string, Record<string, string>>
  selected: boolean
  busy: boolean
  onSelect: (checked: boolean) => void
  onPreview: () => void
  onEdit: () => void
  onConfirm: () => void
  onAction: (step: string) => void
}) {
  const finalized = ['confirmed', 'skipped'].includes(row.row_status)
  const sourceFix = needsSourceFix(row)
  return (
    <tr>
      <td>
        <label>
          <input
            type="checkbox"
            aria-label={`选择第 ${row.row_number} 行`}
            checked={selected}
            disabled={row.row_status !== 'ready' || busy}
            onChange={(event) => onSelect(event.target.checked)}
          />
          第 {row.row_number} 行
        </label>
      </td>
      <td>
        {row.image_url ? (
          <button
            className="import-image-button"
            type="button"
            onClick={onPreview}
            aria-label={`查看第 ${row.row_number} 行大图`}
          >
            <img className="row-image" src={row.image_url} alt={row.draft.name || row.filename} />
          </button>
        ) : (
          <span className="import-no-image">暂无可用图片</span>
        )}
      </td>
      <td>
        <strong>{row.draft.name || row.filename}</strong>
        <p>{fields.category?.[row.draft.category ?? ''] ?? row.draft.category ?? '品类未填写'}</p>
        <small>
          {row.draft.seasons.map((value) => fields.seasons?.[value] ?? value).join(' / ') ||
            '季节未知'}{' '}
          · {row.draft.availability === 'available' ? '可穿' : '暂不可用'}
        </small>
        {!finalized && row.analysis_source && (
          <p>
            <span className="badge">
              {row.analysis_source === 'fake' ? 'Fake 模拟预填' : 'AI 预填 · 请核对'}
            </span>
          </p>
        )}
      </td>
      <td>
        <span className={`import-state import-state-${row.row_status}`}>
          {statusLabel[row.row_status]}
        </span>
        {sourceFix ? (
          <p className="error">需要修正源文件后重新上传</p>
        ) : (
          row.validation_errors.map((error, index) => (
            <p className="error" key={index}>
              {error}
            </p>
          ))
        )}
        {!finalized &&
          row.row_status === 'ready' &&
          ['failed', 'interrupted'].includes(row.analysis_status) && (
            <p className="muted">识别未完成，可核对属性后手工入库。</p>
          )}
        {!finalized &&
          row.row_status === 'ready' &&
          ['failed', 'interrupted'].includes(row.cutout_status) && (
            <p className="muted">去背景未完成，可使用原图。</p>
          )}
        <details className="import-row-details">
          <summary>处理详情</summary>
          <p className="step-status">
            转换：{statusLabel[row.conversion_status] ?? row.conversion_status}
            <br />
            识别：{statusLabel[row.analysis_status] ?? row.analysis_status}
            <br />
            去背景：{statusLabel[row.cutout_status] ?? row.cutout_status}
          </p>
          {row.analysis_notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
          {Object.entries(row.processing_errors).map(([step, error]) => (
            <p className="error" key={step}>
              {String(error)}
            </p>
          ))}
        </details>
      </td>
      <td>
        <div className="row-actions">
          {!finalized && (
            <>
              <Button variant="outline" disabled={busy} onClick={onEdit}>
                修改属性
              </Button>
              <Button disabled={busy || row.row_status !== 'ready'} onClick={onConfirm}>
                核对入库
              </Button>
              <details className="import-more">
                <summary>更多操作</summary>
                {sourceFix ? (
                  <Link className="text-link" to="/imports">
                    修正文件后重新上传
                  </Link>
                ) : (
                  (['conversion', 'analysis', 'cutout'] as const)
                    .filter((step) =>
                      ['failed', 'interrupted', 'cancelled'].includes(row[`${step}_status`]),
                    )
                    .map((step) => (
                      <Button
                        key={step}
                        variant="outline"
                        disabled={busy}
                        onClick={() => onAction(step)}
                      >
                        重试
                        {step === 'conversion' ? '转换' : step === 'analysis' ? '识别' : '去背景'}
                      </Button>
                    ))
                )}
                <Button variant="outline" disabled={busy} onClick={() => onAction('skip')}>
                  移除此行
                </Button>
              </details>
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
}
