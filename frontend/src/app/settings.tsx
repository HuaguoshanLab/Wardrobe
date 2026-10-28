import { PageHeader } from '../components/ui/page-header'
import { lazy, Suspense, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, SlidersHorizontal, MapPin, DatabaseBackup, Activity } from 'lucide-react'
import { PreferencesPanel, LocationPanel, getPreferences, getLocation } from '../features/profile'
import { getTaxonomy } from '../features/wardrobe'
import { BackupPanel } from '../features/backups'
import { getCapabilities } from '../features/system/api'
import { Button } from '../components/ui/button'
import './settings.css'

const Diagnostics = lazy(() =>
  import('../features/system/diagnostics').then((module) => ({ default: module.Diagnostics })),
)
export function Settings() {
  const preferences = useQuery({ queryKey: ['preferences'], queryFn: getPreferences })
  const location = useQuery({ queryKey: ['location'], queryFn: getLocation })
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: getTaxonomy })
  const styles = preferences.data?.preferences.style_codes ?? []
  const entries = [
    {
      path: 'preferences',
      title: '穿衣偏好',
      icon: SlidersHorizontal,
      summary: preferences.isPending
        ? '正在读取…'
        : preferences.isError
          ? '读取失败，进入重试'
          : styles.length
            ? styles.map((code) => taxonomy.data?.fields.style_codes[code] ?? code).join(' · ')
            : '风格、颜色与穿着感受',
    },
    {
      path: 'location',
      title: '默认城市',
      icon: MapPin,
      summary: location.isPending
        ? '正在读取…'
        : location.isError
          ? '读取失败，进入重试'
          : location.data?.city
            ? `${location.data.city.adm1} · ${location.data.city.name}`
            : '尚未设置，可手动选择',
    },
    {
      path: 'backups',
      title: '备份与恢复',
      icon: DatabaseBackup,
      summary: '导出衣橱与穿搭记录，或从备份恢复',
    },
    {
      path: 'services',
      title: '服务状态与诊断',
      icon: Activity,
      summary: '查看搭配、识别与天气服务状态',
    },
  ]
  return (
    <section className="settings-page">
      <div className="page-heading">
        <h1>我的设置</h1>
        <p className="muted">照顾你的偏好，也保管好你的衣橱。</p>
      </div>
      {['个人偏好', '数据与服务'].map((group, index) => (
        <section key={group} className="settings-group">
          <h2>{group}</h2>
          <div className="settings-menu">
            {entries.slice(index * 2, index * 2 + 2).map(({ path, title, icon: Icon, summary }) => (
              <Link
                aria-label={title}
                className="settings-menu-row"
                key={path}
                to={`/settings/${path}`}
              >
                <span className="settings-menu-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <span className="settings-menu-copy">
                  <strong>{title}</strong>
                  <small>{summary}</small>
                </span>
                <ChevronRight size={20} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}
function SettingsDetail({
  title,
  children,
  backTo = '/settings',
}: {
  title: string
  children: ReactNode
  backTo?: string
}) {
  return (
    <section className="settings-detail">
      <PageHeader
        title={title}
        backTo={backTo}
        backLabel={backTo === '/settings' ? '返回设置' : '返回搭配条件'}
      />
      <div className="settings-content">{children}</div>
    </section>
  )
}
export function PreferencesSettings() {
  return (
    <SettingsDetail title="穿衣偏好">
      <PreferencesPanel />
    </SettingsDetail>
  )
}
export function LocationSettings() {
  const [params] = useSearchParams()
  const origin = params.get('returnTo') ?? ''
  const backTo = /^\/outfits\/(?:[a-f0-9-]+\/)?prepare(?:\?.*)?$/.test(origin)
    ? origin
    : '/settings'
  return (
    <SettingsDetail title="默认城市" backTo={backTo}>
      <LocationPanel />
    </SettingsDetail>
  )
}
export function BackupSettings() {
  return (
    <SettingsDetail title="备份与恢复">
      <BackupPanel />
    </SettingsDetail>
  )
}
export function ServiceSettings() {
  const capability = useQuery({ queryKey: ['capabilities'], queryFn: getCapabilities })
  const data = capability.data
  const status = (value: string) =>
    value === 'fake'
      ? '模拟模式'
      : value === 'configured'
        ? '已配置'
        : ['enabled', 'local_u2netp'].includes(value)
          ? '已启用'
          : value === 'disabled'
            ? '未启用'
            : '未配置'
  return (
    <SettingsDetail title="服务状态与诊断">
      <p className="settings-intro">
        查看服务配置。已配置不等于连接验证通过，实际结果以使用时的反馈为准。
      </p>
      {capability.isPending && (
        <div className="panel" role="status">
          正在读取服务状态…
        </div>
      )}
      {capability.isError && (
        <div className="notice">
          <p role="alert">无法读取服务状态：{capability.error.message}</p>
          <Button variant="outline" onClick={() => void capability.refetch()}>
            重新读取
          </Button>
        </div>
      )}
      {data && (
        <section className="panel settings-services">
          {data.maintenance && <p className="notice">正在维护，暂时不能修改衣橱或生成搭配。</p>}
          {[
            [
              'AI 穿搭',
              data.provider_mode === 'fake' ? 'fake' : data.model,
              '仅在你生成或调整搭配时调用。',
            ],
            ['照片识别', data.recognition, '上传照片或主动重试时识别；未配置也可手工填写。'],
            ['天气服务', data.weather, '按默认城市查询；不可用时可手动填写天气。'],
            ['图片去背景', data.cutout, '本地处理，保留原图；关闭后仍可使用原图。'],
          ].map(([name, value, description]) => (
            <article className="settings-service-row" key={name}>
              <div>
                <h2>{name}</h2>
                <p>{description}</p>
              </div>
              <span className="badge">{status(value)}</span>
            </article>
          ))}
        </section>
      )}
      <details className="settings-disclosure settings-advanced">
        <summary>高级工具 · 环境诊断</summary>
        {data?.provider_mode === 'fake' ? (
          <Suspense fallback={<p>正在载入诊断工具…</p>}>
            <Diagnostics />
          </Suspense>
        ) : (
          <p className="muted">
            模拟诊断仅在模拟环境开放。当前页面不会调用云端模型或生成穿搭；服务使用失败时，请查看对应任务的错误提示。
          </p>
        )}
      </details>
    </SettingsDetail>
  )
}
