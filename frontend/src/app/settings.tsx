import { PageHeader } from '../components/ui/page-header'
import { lazy, Suspense, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, SlidersHorizontal, MapPin, DatabaseBackup, Activity } from 'lucide-react'
import { PreferencesPanel, LocationPanel } from '../features/profile'
import { BackupPanel } from '../features/backups'
import { getCapabilities } from '../features/system/api'
import './settings.css'

const Diagnostics = lazy(() =>
  import('../features/system/diagnostics').then((module) => ({ default: module.Diagnostics })),
)
const entries = [
  { path: 'preferences', title: '穿衣偏好', icon: SlidersHorizontal },
  { path: 'location', title: '默认城市', icon: MapPin },
  { path: 'backups', title: '备份与恢复', icon: DatabaseBackup },
  { path: 'services', title: '服务状态与诊断', icon: Activity },
]
export function Settings() {
  return (
    <section className="settings-page">
      <div className="page-heading">
        <h1>我的设置</h1>
      </div>
      <div className="settings-menu">
        {entries.map(({ path, title, icon: Icon }) => (
          <Link className="settings-menu-row" key={path} to={`/settings/${path}`}>
            <span className="settings-menu-icon">
              <Icon size={23} aria-hidden="true" />
            </span>
            <span>{title}</span>
            <ChevronRight size={21} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  )
}
function SettingsDetail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-detail">
      <PageHeader title={title} backTo="/settings" backLabel="返回设置" />
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
  return (
    <SettingsDetail title="默认城市">
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
  return (
    <SettingsDetail title="服务状态与诊断">
      <div className="service-grid">
        <article className="panel">
          <small>模型服务</small>
          <h3>
            {capability.data?.provider_mode === 'fake'
              ? 'Fake Provider'
              : capability.data?.model === 'configured'
                ? '千问搭配服务已配置'
                : '模型未配置'}
          </h3>
          <p>
            {capability.data?.provider_mode === 'fake'
              ? '明确的模拟环境，不请求千问。'
              : capability.data?.model === 'configured'
                ? '点击生成或调整时调用千问；实际可用性以任务结果为准。照片识别状态见下方。'
                : '可继续管理衣橱；生成前需配置模型或明确启用 Fake。'}
          </p>
        </article>
        <article className="panel">
          <small>天气与图片处理</small>
          <p>
            照片识别：
            {capability.data?.recognition === 'fake'
              ? 'Fake 预填'
              : capability.data?.recognition === 'configured'
                ? '千问已配置，上传照片或显式重试时调用；实际可用性待任务验证'
                : '未配置，可手工填写'}
          </p>
          <h3>本地图片处理</h3>
          <p>
            支持 HEIC 转换与去背景，原文件保留。天气服务：
            {capability.data?.weather === 'configured'
              ? '已配置（调用结果见搭配条件页）'
              : '未配置，可手动填写'}
            。
          </p>
        </article>
      </div>
      {capability.isError && (
        <p role="alert" className="error">
          {capability.error.message}
        </p>
      )}
      <Suspense fallback={<p>正在载入诊断工具…</p>}>
        <Diagnostics />
      </Suspense>
    </SettingsDetail>
  )
}
