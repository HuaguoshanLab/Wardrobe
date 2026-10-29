import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { LifecyclePage } from './lifecycle-page'
import { garmentSchema } from './api'
import { today } from './lifecycle-api'

const id = '00000000-0000-4000-8000-000000000001'
const envelope = (data: unknown) => ({ data, request_id: id })
const item = garmentSchema.parse({
  id,
  image_asset_id: id,
  version: 1,
  created_at: new Date().toISOString(),
  image_url: '/image.png',
  has_cutout: false,
  is_demo: false,
  category: 'top',
  name: '衬衫',
  color_codes: [],
  seasons: [],
  occasion_codes: [],
  style_codes: [],
  material: null,
  thickness: null,
  warmth: null,
  custom_tag_ids: [],
  availability: 'available',
  display_variant: 'original',
})
let posts: { key: string | null; body: unknown }[] = []
const server = setupServer(
  http.get('/api/v1/garments/:id', () => HttpResponse.json(envelope(item))),
  http.get('/api/v1/organization/:id/exit-impact', () =>
    HttpResponse.json(
      envelope({
        garment_id: id,
        garment_version: 1,
        token: 'fresh-preview',
        rows: [],
        invalid_sources: [],
      }),
    ),
  ),
  http.post('/api/v1/organization/:id/process', async ({ request }) => {
    posts.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
    return HttpResponse.json(envelope({ ...item, version: 2 }))
  }),
  http.get('/api/v1/garment-subtypes', () => HttpResponse.json(envelope([]))),
  http.get('/api/v1/garments/:id/lifecycle', () =>
    HttpResponse.json(
      envelope({
        items: [],
        next_cursor: null,
        wear_days: 0,
        first_worn_on: null,
        last_worn_on: null,
      }),
    ),
  ),
  http.post('/api/v1/garments/:id/lifecycle', async ({ request }) => {
    posts.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
    return HttpResponse.json(envelope({ ...item, version: 2 }))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  posts = []
  localStorage.clear()
})
afterAll(() => server.close())
function mount(state?: unknown) {
  const router = createMemoryRouter(
    [
      { path: '/wardrobe/:id/lifecycle', element: <LifecyclePage /> },
      { path: '/wardrobe/:id', element: <p>单品详情</p> },
    ],
    { initialEntries: [{ pathname: `/wardrobe/${id}/lifecycle`, state }] },
  )
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return view
}

it('只读打开显示未知和无穿着记录，退出必须明确提交', async () => {
  mount()
  await screen.findByText('暂无穿着记录')
  expect(posts).toHaveLength(0)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '退出衣橱' }))
  expect(posts).toHaveLength(0)
  await user.selectOptions(screen.getByLabelText('退出去向'), 'gifted')
  expect(screen.getByRole('button', { name: '确认退出衣橱' })).toBeDisabled()
  await user.click(screen.getByLabelText('已核对全部季节影响，确认实际退出'))
  await user.click(screen.getByRole('button', { name: '确认退出衣橱' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({
    action: 'gifted',
    occurred_on: today(),
    garment_version: 1,
    impact_token: 'fresh-preview',
  })
})

it('保存丢失响应后刷新仍只重发原负载和原幂等键', async () => {
  server.use(
    http.post('/api/v1/garments/:id/lifecycle', async ({ request }) => {
      posts.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
      return HttpResponse.error()
    }),
  )
  const view = mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '补充获得资料' }))
  await user.type(screen.getByLabelText('购入金额（元）'), '0')
  await user.click(screen.getByRole('button', { name: '保存记录' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  await screen.findAllByText('操作结果尚未确认。刷新不会自动重发。')
  view.unmount()
  mount()
  await screen.findByText('操作结果尚未确认。刷新不会自动重发。')
  expect(posts).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toEqual(posts[0])
})

it('档案草稿离开时确认，取消关闭保留输入', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '补充获得资料' }))
  await user.type(screen.getByLabelText('收纳位置'), '第二层')
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await screen.findByText('放弃未保存的修改？')
  await user.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByLabelText('收纳位置')).toHaveValue('第二层')
  expect(posts).toHaveLength(0)
})

it('放弃子类草稿只关闭子面板，保留获得资料和未提交状态', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '补充获得资料' }))
  await user.type(screen.getByLabelText('收纳位置'), '第二层')
  await user.click(screen.getByRole('button', { name: '新增子类' }))
  await user.type(screen.getByLabelText('子类名称'), '衬衫')
  const child = screen.getByRole('dialog', { name: '新增子类' })
  await user.click(within(child).getByRole('button', { name: '关闭面板' }))
  await user.click(await screen.findByRole('button', { name: '放弃修改' }))
  expect(screen.getByLabelText('收纳位置')).toHaveValue('第二层')
  expect(screen.queryByLabelText('子类名称')).not.toBeInTheDocument()
  expect(posts).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await screen.findByText('放弃未保存的修改？')
})

it('创建子类自动选中并保留资料，只有保存资料才关联单品', async () => {
  const subtypeId = '00000000-0000-4000-8000-000000000002'
  let creates = 0
  server.use(
    http.post('/api/v1/garment-subtypes', () => {
      creates++
      return HttpResponse.json(envelope({ id: subtypeId, category: 'top', name: '衬衫' }))
    }),
  )
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '补充获得资料' }))
  await user.type(screen.getByLabelText('购入金额（元）'), '39.90')
  await user.click(screen.getByRole('button', { name: '新增子类' }))
  await user.type(screen.getByLabelText('子类名称'), '衬衫')
  await user.click(screen.getByRole('button', { name: '创建子类' }))
  await waitFor(() => expect(screen.getByLabelText('子类')).toHaveValue(subtypeId))
  expect(screen.getByLabelText('购入金额（元）')).toHaveValue(39.9)
  expect(creates).toBe(1)
  expect(posts).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '保存记录' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({
    action: 'profile',
    changes: { subtype_id: subtypeId, price: '39.9' },
  })
})

it('完成维修只提供有效状况，可保持待洗；浏览和选择不立即提交', async () => {
  server.use(
    http.get('/api/v1/garments/:id', () =>
      HttpResponse.json(
        envelope({
          ...item,
          availability: 'unavailable',
          lifecycle: { ...item.lifecycle, condition: 'needs_repair', unavailable_reason: 'repair' },
        }),
      ),
    ),
  )
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '完成维修' }))
  expect(
    within(screen.getByLabelText('维修后状况')).queryByText('需要维修'),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: '暂不可用' }))
  expect(within(screen.getByLabelText('暂不可用原因')).queryByText('维修')).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('暂不可用原因'), 'washing')
  expect(posts).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '保存记录' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({
    action: 'repair_complete',
    changes: { condition: 'good', availability: 'unavailable', unavailable_reason: 'washing' },
  })
})

it('清空决定原因发送空字符串，撤销决定仍可保存', async () => {
  server.use(
    http.get('/api/v1/garments/:id', () =>
      HttpResponse.json(
        envelope({
          ...item,
          lifecycle: { ...item.lifecycle, decision: 'keep', decision_reason: '留作备用' },
        }),
      ),
    ),
  )
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^整理决定：/ }))
  await user.clear(screen.getByLabelText('决定原因'))
  await user.click(screen.getByRole('radio', { name: '未决定' }))
  await user.click(screen.getByRole('button', { name: '保存记录' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].body).toMatchObject({
    action: 'decision',
    changes: { decision: 'undecided', decision_reason: '' },
  })
})

it('从换季进入生命周期，刷新后的返回入口仍指向本轮整理', async () => {
  const returnTo = `/wardrobe/seasonal/${id}?review=todo`
  const view = mount({ seasonalReturn: returnTo })
  expect(await screen.findByRole('link', { name: '返回本轮整理' })).toHaveAttribute(
    'href',
    returnTo,
  )
  view.unmount()
  mount({ seasonalReturn: returnTo })
  expect(await screen.findByRole('link', { name: '返回本轮整理' })).toHaveAttribute(
    'href',
    returnTo,
  )
  expect(posts).toHaveLength(0)
})
