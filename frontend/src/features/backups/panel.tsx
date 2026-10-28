import { StepProgress } from '../../components/ui/step-progress'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sheet } from '../../components/ui/sheet'
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const op = useOperation('backups', (value, path) => {
    const accepted = acceptedSchema.parse(value)
    setConfirmOpen(false)
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
    <div className="backup-page">
      {!confirmOpen && <OperationNotice operation={op} />}
      <section className="panel backup-section">
        <h2>导出备份</h2>
        <p className="muted">
          把衣服、图片、偏好和穿搭记录一起保存到你的设备，不包含服务密钥。备份期间暂时不能修改衣橱或生成搭配。
        </p>
        <Button
          disabled={op.busy || (!!backupId && !terminal(backup.data?.status))}
          onClick={() => op.send('/backups', 'POST', {})}
        >
          创建完整备份
        </Button>
        {backup.error && (
          <div>
            <p role="alert">{backup.error.message}</p>
            <Button variant="outline" onClick={() => void backup.refetch()}>
              重试读取备份进度
            </Button>
          </div>
        )}
        {backup.data && (
          <div className="notice">
            <p>备份：{statusNames[backup.data.status] ?? backup.data.status}</p>
            {backup.data.error && <p role="alert">{backup.data.error.message}</p>}
            {backup.data.result?.download_url && (
              <>
                <a href={backup.data.result.download_url} download>
                  下载备份 ZIP（7 天内有效）
                </a>
                <details className="backup-technical">
                  <summary>文件校验信息</summary>
                  <p>SHA-256：{backup.data.result.sha256}</p>
                </details>
              </>
            )}
          </div>
        )}
      </section>
      <section className="panel backup-section">
        <h2>从备份恢复</h2>
        <p className="muted">先检查备份内容，通过验证并确认后才覆盖当前数据。</p>
        <StepProgress
          label="恢复步骤"
          steps={['选择文件', '验证内容', '确认恢复']}
          current={
            !r || ['invalid', 'expired'].includes(r.status) ? 0 : r.status === 'validating' ? 1 : 2
          }
        />
        <RestoreUpload
          disabled={(!!r && ['validating', 'queued', 'running'].includes(r.status)) || op.busy}

          onUploaded={(id) => {
            localStorage.setItem(restoreKey, id)
            setRestoreId(id)
            setConfirmed(false)
            setConfirmOpen(false)
          }}
        />
        {restore.error && (
          <div>
            <p role="alert">{restore.error.message}</p>
            <Button variant="outline" onClick={() => void restore.refetch()}>
              重试读取恢复进度
            </Button>
          </div>
        )}
        {r && (
          <div className="notice">
            <h3>恢复：{statusNames[r.status]}</h3>
            <p>{r.message}</p>
            {r.sha256 && (
              <details className="backup-technical">
                <summary>文件校验信息</summary>
                <p>SHA-256：{r.sha256}</p>
              </details>
            )}
            {!!Object.keys(r.summary).length && (
              <div>
                <h3>已验证的数据摘要</h3>
                <ul className="backup-summary">
                  {Object.entries(r.summary)
                    .filter(([name]) => name in summaryLabels)
                    .map(([name, count]) => (
                      <li key={name}>
                        {summaryLabels[name]}：{count}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {r.status === 'ready' && (
              <>
                <p>
                  验证通过，可以检查覆盖范围后继续。确认有效期至{' '}
                  {new Date(r.expires_at!).toLocaleString('zh-CN')}。
                </p>
                <Button
                  disabled={op.busy}
                  onClick={() => {
                    setConfirmed(false)
                    setConfirmOpen(true)
                  }}
                >
                  检查并恢复
                </Button>
                <Sheet
                  title="确认覆盖当前数据？"
                  trigger={<span hidden />}
                  open={confirmOpen}
                  onOpenChange={(open) => {
                    if (!op.sending) setConfirmOpen(open)
                  }}
                >
                  <p>
                    此备份将替换当前衣橱、图片、偏好、历史、收藏和穿着记录，不是追加导入。切换前系统会保存当前恢复点。
                  </p>
                  <ul className="backup-summary">
                    {Object.entries(r.summary)
                      .filter(([name]) => name in summaryLabels)
                      .map(([name, count]) => (
                        <li key={name}>
                          {summaryLabels[name]}：{count}
                        </li>
                      ))}
                  </ul>
                  <OperationNotice operation={op} />
                  <label className="restore-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    我确认用此备份覆盖当前业务数据
                  </label>
                  <div className="actions">
                    <Button
                      variant="outline"
                      disabled={op.sending}
                      onClick={() => setConfirmOpen(false)}
                    >
                      暂不恢复
                    </Button>
                    <Button
                      disabled={op.busy || !confirmed}
                      onClick={() => {
                        op.send(`/restores/${r.restore_id}/apply`, 'POST', {
                          confirmation_token: r.confirmation_token,
                        })
                      }}
                    >
                      {op.sending ? '正在提交…' : '确认覆盖恢复'}
                    </Button>
                  </div>
                </Sheet>
              </>
            )}
            {r.status === 'succeeded' && (
              <p>
                恢复完成，应用已清理旧缓存。可以返回衣橱查看恢复的数据，之前的任务不会自动运行。
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
