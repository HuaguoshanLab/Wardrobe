import { installSheetHistory } from '../components/ui/sheet-history'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  NavLink,
  Outlet,
  createBrowserRouter,
  Link,
  useLocation,
  ScrollRestoration,
} from 'react-router'
import { ArrowUpRight, Heart, Settings2, Shirt, Sparkles } from 'lucide-react'
import './wardrobe.css'
import './imports.css'
import './mobile-polish.css'
import '../features/profile/profile.css'
import { getCapabilities } from '../features/system/api'

const navigation = [
  { to: '/', label: '今日穿搭', icon: Sparkles },
  { to: '/wardrobe', label: '我的衣橱', icon: Shirt },
  { to: '/collections', label: '穿搭记录', icon: Heart },
  { to: '/settings', label: '设置', icon: Settings2 },
]

function Shell() {
  const pathname = useLocation().pathname
  const queryClient = useQueryClient()
  const capability = useQuery({
    queryKey: ['capabilities'],
    queryFn: getCapabilities,
    refetchInterval: 15000,
  })
  const [epoch, setEpoch] = useState(() => localStorage.getItem('wardrobe.data_epoch') ?? 'initial')
  useEffect(() => {
    const next = capability.data?.data_epoch
    if (!next) return
    const previous = localStorage.getItem('wardrobe.data_epoch')
    if (previous && previous !== next) {
      localStorage.removeItem('wardrobe.diagnostic')
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('wardrobe.') && key !== 'wardrobe.data_epoch')
          localStorage.removeItem(key)
      }
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'capabilities' })
    }
    localStorage.setItem('wardrobe.data_epoch', next)
    if (previous && previous !== next) setEpoch(next)
  }, [capability.data?.data_epoch, queryClient])
  return (
    <div className="app-shell">
      <ScrollRestoration />
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Shirt size={22} />
          </span>
          <span>
            衣序<small>WARDROBE</small>
          </span>
        </Link>
        <span className="nav-caption">我的日常</span>
        <nav aria-label="主导航">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive ||
                (to === '/wardrobe' && pathname.startsWith('/imports')) ||
                (to === '/' && pathname.startsWith('/outfits/'))
                  ? 'active'
                  : undefined
              }
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          你的衣橱，你的风格<small>慢慢收集，认真穿着。</small>
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <span>让每一件衣服，都有自己的位置。</span>
          <span className="connection">
            <i className={capability.isSuccess ? 'online' : ''} />
            {capability.isSuccess ? '服务已连接' : capability.isError ? '服务连接失败' : '正在连接'}
          </span>
        </header>
        {capability.data?.maintenance && (
          <p role="status" className="notice">
            数据维护中，暂时不能修改或生成；已有任务会等待安全结束。
          </p>
        )}
        <main key={epoch} id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer>
          衣序 · 个人衣橱助手 <span>从整理开始，慢慢找到自己的风格。</span>
        </footer>
      </div>
    </div>
  )
}

function Planned({ title, description }: { title: string; description: string }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PAGE NOT FOUND</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <section className="panel planned">
        <Shirt size={40} strokeWidth={1} />
        <h2>这个页面不存在</h2>
        <p>链接可能已失效，请通过导航返回衣橱或今日穿搭。</p>
        <Link to="/" className="text-link">
          返回今日穿搭 <ArrowUpRight size={16} />
        </Link>
      </section>
    </>
  )
}

installSheetHistory()

export const router = createBrowserRouter([
  {
    Component: Shell,
    errorElement: (
      <div className="planned">
        <h1>页面暂时无法显示</h1>
        <a href="/">返回首页</a>
      </div>
    ),
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('../features/profile/home')).HomePage }),
      },
      {
        path: 'outfits/:sessionId',
        lazy: async () => ({ Component: (await import('../features/profile/home')).HomePage }),
      },
      {
        path: 'outfits/prepare',
        lazy: async () => ({
          Component: (await import('../features/profile/prepare')).ConditionsPage,
        }),
      },
      {
        path: 'outfits/:sessionId/prepare',
        lazy: async () => ({
          Component: (await import('../features/profile/prepare')).ConditionsPage,
        }),
      },
      {
        path: 'outfits/:sessionId/edit',
        lazy: async () => ({
          Component: (await import('../features/outfits/edit')).OutfitEditPage,
        }),
      },
      {
        path: 'settings',
        lazy: async () => ({ Component: (await import('./settings')).Settings }),
      },
      {
        path: 'settings/preferences',
        lazy: async () => ({ Component: (await import('./settings')).PreferencesSettings }),
      },
      {
        path: 'settings/location',
        lazy: async () => ({ Component: (await import('./settings')).LocationSettings }),
      },
      {
        path: 'settings/backups',
        lazy: async () => ({ Component: (await import('./settings')).BackupSettings }),
      },
      {
        path: 'settings/services',
        lazy: async () => ({ Component: (await import('./settings')).ServiceSettings }),
      },
      {
        path: 'wardrobe/:id',
        lazy: async () => ({ Component: (await import('../features/wardrobe/page')).GarmentPage }),
      },
      {
        path: 'imports',
        lazy: async () => ({ Component: (await import('../features/imports/upload')).ImportPage }),
      },
      {
        path: 'imports/:id',
        lazy: async () => ({ Component: (await import('../features/imports/review')).ReviewPage }),
      },
      {
        path: 'wardrobe',
        lazy: async () => ({ Component: (await import('../features/wardrobe/page')).WardrobePage }),
      },
      {
        path: 'collections',
        lazy: async () => ({
          Component: (await import('../features/collections/pages')).CollectionsPage,
        }),
      },
      {
        path: 'calendar',
        lazy: async () => ({
          Component: (await import('../features/collections/pages')).CalendarPage,
        }),
      },
      {
        path: 'collections/:revisionId',
        lazy: async () => ({
          Component: (await import('../features/collections/revision')).RevisionPage,
        }),
      },
      { path: '*', element: <Planned title="页面不存在" description="请通过导航进入已有页面。" /> },
    ],
  },
])
