import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation } from '../../lib/use-operation'
import { acceptedSchema, getBackupJob, getRestore, terminal } from './api'
import { RestoreUpload } from './upload'

// Control records survive data_epoch changes because they are outside the business database.
const summaryLabels: Record<string, string> = {
  'public.garments': '衣服（含已删除）',
  'public.media_assets': '媒体原件',
  'public.import_rows': '导入记录',
  'public.outfit_revisions': '搭配版本（含已隐藏）',
  'public.favorites': '收藏',
  'public.wear_records': '穿着记录',
  'public.profiles': '个人设置',
  media_files: '图片和原件文件',
}
const backupKey = 'wardrobe-control.backup'
const restoreKey = 'wardrobe-control.restore'
const statusNames: Record<string, string> = {
  queued: '等待维护窗口',
  running: '处理中',
  succeeded: '成功',
  failed: '失败',
  interrupted: '中断',
  validating: '隔离验证中',
  ready: '等待确认',
  invalid: '验证失败',
  expired: '确认已过期',
}
export function BackupPanel() {
  const [backupId, setBackupId] = useState(() => localStorage.getItem(backupKey))
  const [restoreId, setRestoreId] = useState(() => localStorage.getItem(restoreKey))
  const [confirmed, setConfirmed] = useState(false)
  const op = useOperation('backups', (value, path) => {
    const accepted = acceptedSchema.parse(value)
    if (path === '/backups') {
      localStorage.setItem(backupKey, accepted.job_id)
      setBackupId(accepted.job_id)
    }
  })
  const backup = useQuery({
    queryKey: ['backup', backupId],
    enabled: !!backupId,
    queryFn: () => getBackupJob(backupId!),
    refetchInterval: (q) => (terminal(q.state.data?.status) ? false : 1000),
  })
  const restore = useQuery({
    queryKey: ['restore', restoreId],
    enabled: !!restoreId,
    queryFn: () => getRestore(restoreId!),
    refetchInterval: (q) =>
      ['validating', 'queued', 'running'].includes(q.state.data?.status ?? 'validating')
        ? 1000
        : false,
  })
  const r = restore.data
  return (
    <section className="panel attribute-form">
      <h2>备份与恢复</h2>
      <p>备份包含业务记录、检查点和引用图片，排除服务凭据。维护期间暂时不能修改衣橱或生成搭配。</p>
      <OperationNotice operation={op} />
      <Button
        disabled={op.busy || (!!backupId && !terminal(backup.data?.status))}
        onClick={() => op.send('/backups', 'POST', {})}
      >
        创建完整备份
      </Button>
      {backup.error && <p role="alert">{backup.error.message}</p>}
      {backup.data && (
        <div className="notice">
          <p>备份：{statusNames[backup.data.status] ?? backup.data.status}</p>
          {backup.data.error && <p role="alert">{backup.data.error.message}</p>}
          {backup.data.result?.download_url && (
            <>
              <a href={backup.data.result.download_url} download>
                下载备份 ZIP（7 天内有效）
              </a>
              <p style={{ overflowWrap: 'anywhere' }}>SHA-256：{backup.data.result.sha256}</p>
            </>
          )}
        </div>
      )}
      <RestoreUpload
        onUploaded={(id) => {
          localStorage.setItem(restoreKey, id)
          setRestoreId(id)
          setConfirmed(false)
        }}
      />
      {restore.error && <p role="alert">{restore.error.message}</p>}
      {r && (
        <div className="notice">
          <h3>恢复：{statusNames[r.status]}</h3>
          <p>{r.message}</p>
          {r.sha256 && <p style={{ overflowWrap: 'anywhere' }}>备份 SHA-256：{r.sha256}</p>}
          {!!Object.keys(r.summary).length && (
            <details>
              <summary>已验证的数据摘要</summary>
              <ul>
                {Object.entries(r.summary)
                  .filter(([name]) => name in summaryLabels)
                  .map(([name, count]) => (
                    <li key={name}>
                      {summaryLabels[name]}：{count}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {r.status === 'ready' && (
            <>
              <p>
                确认将覆盖当前衣橱、历史、收藏、日历和偏好。切换前保存当前恢复点。确认有效期至{' '}
                {new Date(r.expires_at!).toLocaleString('zh-CN')}。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我确认用此备份覆盖当前业务数据
              </label>
              <Button
                disabled={op.busy || !confirmed}
                onClick={() =>
                  op.send(`/restores/${r.restore_id}/apply`, 'POST', {
                    confirmation_token: r.confirmation_token,
                  })
                }
              >
                确认覆盖恢复
              </Button>
            </>
          )}
          {r.status === 'succeeded' && (
            <p>恢复成功，旧缓存和待发业务操作已按数据世代清除。旧任务不会自动执行。</p>
          )}
        </div>
      )}
    </section>
  )
}
