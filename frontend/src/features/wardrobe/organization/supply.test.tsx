import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { SupplyEditorPage } from './supply-editor'
import { SupplyDetailPage } from './supply-detail'

const id = '00000000-0000-4000-8000-000000000001'
const envelope = (data: unknown) => ({ data, request_id: id })
const plan = {
  id,
  version: 2,
  name: '通勤衬衫',
  quantity: 2,
  budget: null,
  reason: '轮换',
  notes: '',
  status: 'purchased',
  cancelled_quantity: 0,
  remaining: 1,
  sources: [],
  linked: [{ id: '00000000-0000-4000-8000-000000000002', name: '已入库衬衫', archived: false }],
}
let writes: { key: string | null; body: unknown }[] = []
const server = setupServer(
  http.get('/api/v1/inventory/configs', () => HttpResponse.json(envelope([]))),
  http.get('/api/v1/supply-plans/:id', () => HttpResponse.json(envelope(plan))),
  http.post('/api/v1/supply-plans/:id', async ({ request }) => {
    writes.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
    return HttpResponse.json(envelope(plan))
  }),
  http.post('/api/v1/supply-plans/:id/cancel-remaining', async ({ request }) => {
    writes.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
    return HttpResponse.json(envelope(plan))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  writes = []
  localStorage.clear()
})
afterAll(() => server.close())
function mount(path = `/wardrobe/organization/plans/${id}/edit?new=1`) {
  const router = createMemoryRouter(
    [
      { path: '/wardrobe/organization/plans/:id/edit', element: <SupplyEditorPage /> },
      { path: '/wardrobe/organization/plans/:id', element: <SupplyDetailPage /> },
      { path: '/wardrobe/organization', element: <p>整理清单入口</p> },
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
it('计划保存丢失响应后刷新不重发，显式重试保留原键、预算零和数量', async () => {
  server.use(
    http.post('/api/v1/supply-plans/:id', async ({ request }) => {
      writes.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
      return HttpResponse.error()
    }),
  )
  const view = mount()
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('计划名称'), '夏季轮换')
  await user.clear(screen.getByLabelText('计划数量'))
  await user.type(screen.getByLabelText('计划数量'), '2')
  await user.type(screen.getByLabelText('总预算（元，可不填）'), '0')
  await user.selectOptions(screen.getByLabelText('计划状态'), 'purchased')
  await user.click(screen.getByRole('button', { name: '保存补充计划' }))
  await screen.findByText('操作结果尚未确认。刷新不会自动重发。')
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toMatchObject({
    quantity: 2,
    budget: '0',
    status: 'purchased',
    expected_version: 0,
  })
  view.unmount()
  mount()
  expect(await screen.findByLabelText('计划名称')).toHaveValue('夏季轮换')
  expect(writes).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1]).toEqual(writes[0])
})
it('离开新计划先保护草稿，取消剩余是独立确认动作', async () => {
  const view = mount()
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('计划名称'), '不丢草稿')
  await user.click(screen.getByRole('link', { name: '返回补充计划' }))
  await user.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByLabelText('计划名称')).toHaveValue('不丢草稿')
  expect(writes).toHaveLength(0)
  view.unmount()
  mount(`/wardrobe/organization/plans/${id}`)
  await user.click(await screen.findByRole('button', { name: '取消剩余 1 件' }))
  expect(writes).toHaveLength(0)
  expect(await screen.findByRole('dialog')).toHaveTextContent('已关联的 1 件和现有衣服保留')
  await user.click(screen.getByRole('button', { name: '确认取消剩余数量' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body).toEqual({ expected_version: 2 })
})
