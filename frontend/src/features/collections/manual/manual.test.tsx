import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { ManualPage } from './page'
import { emptyDraft, pick, type ManualInput } from './state'
import { today } from '../api'
import { garmentSchema } from '../../wardrobe/api'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const envelope = (data: unknown) => ({ data, request_id: id(99) })
const item = (n: number, available = true) =>
  garmentSchema.parse({
    id: id(n),
    version: 1,
    name: `单品${n}`,
    category: 'top',
    image_asset_id: id(10),
    image_url: '/test.png',
    created_at: '2026-10-01T00:00:00Z',
    is_demo: false,
    has_cutout: false,
    color_codes: [],
    seasons: [],
    occasion_codes: [],
    style_codes: [],
    custom_tag_ids: [],
    material: null,
    thickness: null,
    warmth: null,
    display_variant: 'original',
    availability: available ? 'available' : 'unavailable',
  })
let writes: { key: string | null; body: ManualInput }[] = []
let fail = false
let rejected = false
const result = (body: ManualInput) => {
  const revision = {
    id: id(20),
    source: 'manual',
    session_id: null,
    run_id: null,
    provider_mode: null,
    parent_revision_id: body.parent_revision_id ?? null,
    items: [],
    reason: '手动',
    unmet_requirements: [],
    weather_snapshot: {},
    request_snapshot: {},
    created_at: '2026-10-30T00:00:00Z',
  }
  return {
    revision,
    wear:
      body.mode === 'wear'
        ? {
            id: id(21),
            revision_id: id(20),
            revision,
            worn_on: body.worn_on,
            notes: body.notes,
            timezone: 'Asia/Shanghai',
            version: 1,
            created_at: '2026-10-30T00:00:00Z',
          }
        : null,
  }
}
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(envelope({ version: 1, fields: { category: { top: '上装' } } })),
  ),
  http.get('/api/v1/garments', ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(
      envelope({
        items: url.searchParams.has('cursor') ? [item(2, false)] : [item(1)],
        next_cursor: url.searchParams.has('cursor') ? null : id(1),
      }),
    )
  }),
  http.get('/api/v1/garments/:id', ({ params }) =>
    HttpResponse.json(envelope(item(params.id === id(1) ? 1 : 2, params.id === id(1)))),
  ),
  http.post('/api/v1/manual-outfits', async ({ request }) => {
    const body = (await request.json()) as ManualInput
    writes.push({ key: request.headers.get('Idempotency-Key'), body })
    if (fail) return HttpResponse.error()
    if (rejected)
      return HttpResponse.json(
        { error: { code: 'VERSION_CONFLICT', message: '单品已变更' } },
        { status: 409 },
      )
    return HttpResponse.json(envelope(result(body)), { status: 201 })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  writes = []
  fail = false
  rejected = false
})
afterAll(() => server.close())
function mount(path = '/collections/manual') {
  const router = createMemoryRouter(
    [
      { path: '/collections/manual', element: <ManualPage /> },
      { path: '/collections', element: <p>返回记录</p> },
    ],
    { initialEntries: [path] },
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
function seed(unavailable = false) {
  localStorage.setItem(
    'wardrobe.manual.new.draft',
    JSON.stringify({ ...emptyDraft(), items: [pick(item(1, !unavailable))] }),
  )
}

it('跨分页选择、筛选和关闭面板保留组合，保存不会附带穿着', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '选择衣服' }))
  await user.click(await screen.findByRole('button', { name: '选择：单品1' }))
  await user.click(screen.getByRole('button', { name: '加载更多衣服' }))
  await user.click(await screen.findByRole('button', { name: '选择：单品2' }))
  await user.selectOptions(screen.getByLabelText('品类'), 'top')
  await user.click(screen.getByRole('button', { name: '完成选择（2 件）' }))
  expect(screen.getByRole('button', { name: '保存手动搭配' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '移除：单品2' }))
  await user.click(screen.getByRole('button', { name: '保存手动搭配' }))
  await screen.findByText('手动搭配已保存')
  expect(writes).toHaveLength(1)
  expect(writes[0].body.items).toEqual([{ garment_id: id(1), expected_version: 1 }])
  expect(writes[0].body.mode).toBe('save')
  expect(writes[0].body.worn_on).toBeUndefined()
  expect(localStorage.getItem('wardrobe.manual.new.draft')).toBeNull()
})

it('暂不可用仅在明确确认实际穿着后可记录，保留日期备注', async () => {
  const user = userEvent.setup()
  seed(true)
  mount()
  await user.click(screen.getByLabelText('直接记录实际穿着'))
  expect(screen.getByRole('button', { name: '确认记录穿着' })).toBeDisabled()
  await user.type(screen.getByLabelText('穿着备注（选填）'), '昨天穿的')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: '确认记录穿着' }))
  await screen.findByText('穿着已记录')
  expect(writes[0].body.acknowledged_unavailable_ids).toEqual([id(1)])
  expect(writes[0].body.notes).toBe('昨天穿的')
  expect(writes[0].body.worn_on).toBe(today())
})

it('网络结果不明时刷新不自动提交，重发保留相同请求键和负载', async () => {
  const user = userEvent.setup()
  seed()
  fail = true
  const first = mount()
  await user.click(screen.getByRole('button', { name: '保存手动搭配' }))
  await screen.findByRole('alert')
  expect(writes).toHaveLength(1)
  first.unmount()
  fail = false
  mount()
  expect(screen.getByRole('button', { name: '保存手动搭配' })).toBeDisabled()
  expect(writes).toHaveLength(1)
  expect(screen.queryByText('读取最新状态并继续修改')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await screen.findByText('手动搭配已保存')
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
})

it('明确版本冲突后重新读取保留选择和备注，再次提交使用新版本', async () => {
  const user = userEvent.setup()
  seed()
  rejected = true
  server.use(
    http.get('/api/v1/garments/:id', () => HttpResponse.json(envelope({ ...item(1), version: 2 }))),
  )
  mount()
  await user.click(screen.getByLabelText('直接记录实际穿着'))
  await user.type(screen.getByLabelText('穿着备注（选填）'), '保留备注')
  await user.click(screen.getByRole('button', { name: '确认记录穿着' }))
  await screen.findByText('单品已变更')
  await user.click(screen.getByRole('button', { name: '读取最新状态并继续修改' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '确认记录穿着' })).toBeEnabled())
  expect(screen.getByLabelText('穿着备注（选填）')).toHaveValue('保留备注')
  rejected = false
  await user.click(screen.getByRole('button', { name: '确认记录穿着' }))
  await screen.findByText('穿着已记录')
  expect(writes[1].body.items[0].expected_version).toBe(2)
  expect(writes[1].key).not.toBe(writes[0].key)
})

it('所选单品读取失败时保留可移除的对象，不能静默少记一件', async () => {
  const user = userEvent.setup()
  seed()
  server.use(
    http.get('/api/v1/garments/:id', () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND', message: '衣服已删除' } }, { status: 404 }),
    ),
  )
  mount()
  await user.click(screen.getByRole('button', { name: '重新核对所选衣服' }))
  await screen.findByText('衣服已删除')
  expect(screen.getByRole('button', { name: '保存手动搭配' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '移除：单品1' })).toBeEnabled()
  expect(writes).toHaveLength(0)
})

it('只看已选可跨筛选核对和取消，返回衣橱不会丢掉其余选择', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '选择衣服' }))
  await user.click(await screen.findByRole('button', { name: '选择：单品1' }))
  await user.click(screen.getByRole('button', { name: '加载更多衣服' }))
  await user.click(await screen.findByRole('button', { name: '选择：单品2' }))
  await user.selectOptions(screen.getByLabelText('品类'), 'top')
  await user.click(screen.getByRole('button', { name: '已选（2）' }))
  expect(screen.getByRole('button', { name: '取消选择：单品2' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '取消选择：单品2' }))
  expect(screen.getByRole('button', { name: '已选（1）' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: '我的衣橱' }))
  expect(screen.getByLabelText('品类')).toHaveValue('top')
  expect(screen.getByRole('button', { name: '取消选择：单品1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(screen.getByRole('button', { name: '完成选择（1 件）' }))
  expect(screen.getByRole('button', { name: '移除：单品1' })).toBeInTheDocument()
  expect(writes).toHaveLength(0)
})
