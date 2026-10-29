import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { InventoryEditorPage } from './editor'
import { InventoryPage } from './page'
import { newDemand, type Plan } from './api'

const id = '00000000-0000-4000-8000-000000000001'
const envelope = (data: unknown) => ({ data, request_id: id })
const initial: Plan = { season: 'summer', version: 0, city: '', period: '', notes: '', rows: [] }
let plan = structuredClone(initial)
let writes: { key: string | null; body: unknown }[] = []
const snapshot = () => ({
  plan,
  stats_at: '2026-10-29T08:00:00Z',
  config_versions: { summer: plan.version },
  total_owned: 0,
  garments: [],
  counts: plan.rows.map((r) => ({
    row_id: r.id,
    matched_owned: 0,
    confirmed: 0,
    pending: 0,
    unavailable: 0,
    available: 0,
    needs_attention: 0,
    shared: 0,
    conclusion: r.lower === null ? 'unset' : 'enough',
    difference: r.lower === null ? null : 0,
    rule_errors: [],
    members: [],
  })),
})
const server = setupServer(
  http.get('/api/v1/inventory/summer', () => HttpResponse.json(envelope(snapshot()))),
  http.get('/api/v1/inventory/configs', () =>
    HttpResponse.json(
      envelope([
        plan,
        {
          ...initial,
          season: 'spring',
          version: 1,
          rows: [{ ...newDemand(), id, name: '春季衬衫', lower: 3, upper: 5 }],
        },
      ]),
    ),
  ),
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({
        version: 1,
        fields: {
          category: { top: '上装', outerwear: '外套' },
          occasion_codes: { work: '通勤', daily: '日常' },
        },
      }),
    ),
  ),
  http.get('/api/v1/tags', () => HttpResponse.json(envelope([]))),
  http.get('/api/v1/garment-subtypes', () => HttpResponse.json(envelope([]))),
  http.post('/api/v1/inventory/summer', async ({ request }) => {
    const body = (await request.json()) as { expected_version: number } & Omit<
      Plan,
      'version' | 'season'
    >
    writes.push({ key: request.headers.get('Idempotency-Key'), body })
    plan = { ...body, season: 'summer', version: body.expected_version + 1 }
    delete (plan as Partial<typeof body>).expected_version
    return HttpResponse.json(envelope(plan))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  writes = []
  plan = structuredClone(initial)
})
afterAll(() => server.close())
function mount(entry = '/wardrobe/inventory/summer/edit', state?: unknown) {
  const router = createMemoryRouter(
    [
      { path: '/wardrobe/inventory/:season/edit', element: <InventoryEditorPage /> },
      { path: '/wardrobe/inventory', element: <InventoryPage /> },
      { path: '/wardrobe/seasonal/:id', element: <h1>继续本轮整理</h1> },
    ],
    { initialEntries: [state ? { pathname: entry, state } : entry] },
  )
  return render(
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
}

it('需求先进入草稿，0–0 明确保存后返回盘点且不触发离开确认', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '新增需求' }))
  await user.type(screen.getByLabelText('需求名称'), '夏季上装')
  await user.type(screen.getByLabelText('目标下限'), '0')
  await user.type(screen.getByLabelText('目标上限'), '0')
  await user.click(screen.getByRole('button', { name: '应用到本季草稿' }))
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '保存本季目标' }))
  await screen.findByRole('heading', { name: '四季盘点' })
  expect(screen.queryByText('放弃未保存的修改？')).not.toBeInTheDocument()
  expect(writes[0].body).toMatchObject({
    expected_version: 0,
    rows: [{ name: '夏季上装', lower: 0, upper: 0 }],
  })
})

it('取消需求编辑保留本季已有草稿，复制只追加新 ID 并且不自动保存', async () => {
  plan.rows = [{ ...newDemand(), name: '已有需求' }]
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByText('复制其他季节的需求'))
  await user.selectOptions(screen.getByLabelText('复制来源'), 'spring')
  await user.click(screen.getByRole('button', { name: '追加到本季草稿' }))
  await screen.findByRole('heading', { name: '春季衬衫' })
  await user.click(screen.getByRole('button', { name: '新增需求' }))
  await user.type(screen.getByLabelText('需求名称'), '应放弃')
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await user.click(await screen.findByRole('button', { name: '放弃修改' }))
  expect(screen.getByRole('heading', { name: '已有需求' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '春季衬衫' })).toBeInTheDocument()
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '保存本季目标' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(plan.rows).toHaveLength(2)
  expect(plan.rows[1].id).not.toBe(id)
})

it('失败保存刷新后只显式重发同一个负载与操作键', async () => {
  server.use(
    http.post('/api/v1/inventory/summer', async ({ request }) => {
      writes.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
      return HttpResponse.error()
    }),
  )
  const view = mount()
  const user = userEvent.setup()
  await user.click(await screen.findByText('复制其他季节的需求'))
  await user.selectOptions(screen.getByLabelText('复制来源'), 'spring')
  await user.click(screen.getByRole('button', { name: '追加到本季草稿' }))
  await user.click(screen.getByRole('button', { name: '保存本季目标' }))
  await screen.findByText('操作结果尚未确认。刷新不会自动重发。')
  view.unmount()
  mount()
  await screen.findByRole('heading', { name: '春季衬衫' })
  expect(writes).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1]).toEqual(writes[0])
})

it('非法目标不能应用到草稿；明确放弃离开才丢弃草稿', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '新增需求' }))
  await user.type(screen.getByLabelText('需求名称'), '无效目标')
  await user.type(screen.getByLabelText('目标下限'), '5')
  await user.type(screen.getByLabelText('目标上限'), '3')
  await user.click(screen.getByRole('button', { name: '应用到本季草稿' }))
  await screen.findByRole('alert')
  expect(within(screen.getByRole('dialog')).getByLabelText('目标下限')).toHaveValue(5)
  expect(writes).toHaveLength(0)
})

it('指定需求直接打开编辑，清空目标只改草稿且保留其他需求', async () => {
  const first = { ...newDemand(), name: '日常上装', lower: 3, upper: 5 }
  const second = { ...newDemand(), name: '通勤衬衫', lower: 2, upper: 4 }
  plan.rows = [first, second]
  mount(`/wardrobe/inventory/summer/edit?row=${second.id}`)
  const user = userEvent.setup()
  expect(await screen.findByLabelText('需求名称')).toHaveValue('通勤衬衫')
  await user.click(screen.getByRole('button', { name: '暂不设目标' }))
  expect(screen.getByLabelText('目标下限')).toHaveValue(null)
  expect(screen.getByLabelText('目标上限')).toHaveValue(null)
  await user.click(screen.getByRole('button', { name: '应用到本季草稿' }))
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '保存本季目标' }))
  await screen.findByRole('heading', { name: '四季盘点' })
  expect(writes[0].body).toMatchObject({
    rows: [
      { id: first.id, lower: 3, upper: 5 },
      { id: second.id, lower: null, upper: null },
    ],
  })
})

it('从换季进入目标编辑，保存后返回原整理会话', async () => {
  const returnTo = `/wardrobe/seasonal/${id}?review=todo&find=衬衫`
  mount(undefined, { seasonalReturn: returnTo })
  const user = userEvent.setup()
  expect(await screen.findByRole('link', { name: '返回本轮整理' })).toHaveAttribute(
    'href',
    returnTo,
  )
  await user.click(await screen.findByText('复制其他季节的需求'))
  await user.selectOptions(screen.getByLabelText('复制来源'), 'spring')
  await user.click(screen.getByRole('button', { name: '追加到本季草稿' }))
  await user.click(screen.getByRole('button', { name: '保存本季目标' }))
  await screen.findByRole('heading', { name: '继续本轮整理' })
  expect(writes).toHaveLength(1)
})
