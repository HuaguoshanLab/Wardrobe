import { lazy, Suspense, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, createBrowserRouter, Link } from 'react-router'
import {
  ArrowUpRight,
  CalendarDays,
  Heart,
  LayoutGrid,
  Settings2,
  Shirt,
  Sparkles,
} from 'lucide-react'
import './wardrobe.css'
import { getCapabilities } from '../features/system/api'
const Diagnostics = lazy(() =>
  import('../features/system/diagnostics').then((module) => ({ default: module.Diagnostics })),
)

const navigation = [
  { to: '/', label: '今日穿搭', icon: Sparkles },
  { to: '/wardrobe', label: '我的衣橱', icon: Shirt },
  { to: '/collections', label: '历史与收藏', icon: Heart },
  { to: '/calendar', label: '穿搭日历', icon: CalendarDays },
  { to: '/settings', label: '设置', icon: Settings2 },
]

function Shell() {
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
            <NavLink key={to} to={to} end>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          个人衣橱 · 本地运行<small>P2 / 衣橱与录入</small>
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
        <main key={epoch}>
          <Outlet />
        </main>
        <footer>
          衣序 · 个人衣橱助手 <span>从整理开始，慢慢找到自己的风格。</span>
        </footer>
      </div>
    </div>
  )
}

function Home() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR EVERYDAY EDIT</span>
          <h1>今日穿搭</h1>
          <p>从你的衣橱出发，找到适合今天的组合。</p>
        </div>
        <span className="badge">衣橱已开放</span>
      </div>
      <section className="welcome-panel">
        <div>
          <span className="eyebrow">A LITTLE MORE INTENTIONAL</span>
          <h2>
            把衣橱整理好，
            <br />
            把日常穿得更自在。
          </h2>
          <p>先从整理衣橱开始。上传单品照片或导入 Excel，逐件确认，留下你的日常选择。</p>
          <Link className="text-link" to="/wardrobe">
            整理我的衣橱 <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="wardrobe-illustration" aria-hidden="true">
          <span className="rail" />
          <Shirt strokeWidth={0.6} />
          <span className="illustration-caption">LESS GUESSING, MORE YOU.</span>
        </div>
      </section>
      <div className="section-heading">
        <h2>从衣橱开始</h2>
        <span>按阶段逐步开放</span>
      </div>
      <div className="step-grid">
        {[
          ['01', '录入你的衣服', '照片批量上传或 Excel 导入，审核后放入衣橱。', 'P2 · 已开放'],
          ['02', '告诉我今天的安排', '结合城市天气、场合和你的穿衣偏好。', 'P3 · 待开发'],
          ['03', '挑选合适的搭配', '最多三套，保留喜欢的单品，再调整其他部分。', 'P4 · 待开发'],
        ].map(([n, title, text, phase]) => (
          <article className="step-card" key={n}>
            <span className="step-number">{n}</span>
            <h3>{title}</h3>
            <p>{text}</p>
            <span className="phase">{phase}</span>
          </article>
        ))}
      </div>
      <div className="honest-note">
        <LayoutGrid size={18} />
        <p>
          衣橱录入已开放；天气与搭配将在后续阶段加入。当前识别为明确标记的模拟结果，请人工核对。
        </p>
      </div>
    </>
  )
}

function Settings() {
  const capability = useQuery({ queryKey: ['capabilities'], queryFn: getCapabilities })
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SPACE</span>
          <h1>设置与环境</h1>
          <p>查看当前能力，验证基础服务是否正常工作。</p>
        </div>
      </div>
      <div className="service-grid">
        <article className="panel">
          <small>模型服务</small>
          <h3>{capability.data?.provider_mode === 'fake' ? 'Fake Provider' : '尚未启用'}</h3>
          <p>明确的模拟环境，不请求千问。</p>
        </article>
        <article className="panel">
          <small>天气与图片处理</small>
          <h3>本地图片处理</h3>
          <p>支持 HEIC 转换与去背景，原文件保留。和风天气尚未接入。</p>
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
    </>
  )
}

function Planned({ title, description }: { title: string; description: string }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMING NEXT</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <section className="panel planned">
        <Shirt size={40} strokeWidth={1} />
        <h2>这个空间正在准备中</h2>
        <p>当前阶段已开放衣橱与录入。此功能将在后续阶段开放。</p>
        <Link to="/" className="text-link">
          返回今日穿搭 <ArrowUpRight size={16} />
        </Link>
      </section>
    </>
  )
}

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
      { index: true, Component: Home },
      { path: 'settings', Component: Settings },
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
        element: <Planned title="历史与收藏" description="留下每一次喜欢的搭配。P5 待开发。" />,
      },
      {
        path: 'calendar',
        element: <Planned title="穿搭日历" description="记录实际穿过的搭配。P5 待开发。" />,
      },
      { path: '*', element: <Planned title="页面不存在" description="请通过导航进入已有页面。" /> },
    ],
  },
])
