import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { garmentSchema } from '../api'
import { DecisionPage } from './decision-page'

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
let writes: { key: string | null; body: unknown }[] = []
let retired = false
const server = setupServer(
  http.get('/api/v1/garments/:id', () =>
    HttpResponse.json(
      envelope({
        ...item,
        ownership: retired ? 'retired' : 'owned',
        version: retired ? 2 : 1,
      }),
    ),
  ),
  http.get('/api/v1/organization/:id', () =>
    HttpResponse.json(
      envelope({
        shortages: [],
        candidates: [],
        next_cursor: null,
        stats_at: new Date().toISOString(),
      }),
    ),
  ),
  http.get('/api/v1/organization/:id/exit-impact', () =>
    HttpResponse.json(
      envelope({
        garment_id: id,
        garment_version: 1,
        token: 'preview-before-exit',
        rows: [],
        invalid_sources: [],
      }),
    ),
  ),
  http.post('/api/v1/organization/:id/process', async ({ request }) => {
    writes.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
    retired = true
    if (writes.length === 1) return HttpResponse.error()
    return HttpResponse.json(envelope({ ...item, ownership: 'retired', version: 2 }))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  writes = []
  retired = false
  localStorage.clear()
})
afterAll(() => server.close())
function mount() {
  const router = createMemoryRouter(
    [
      { path: '/wardrobe/organization/garments/:id', element: <DecisionPage /> },
      { path: '/wardrobe/organization', element: <p>整理清单入口</p> },
    ],
    { initialEntries: [`/wardrobe/organization/garments/${id}`] },
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
it('退出响应丢失后，刷新自动恢复面板但不重发，已归档仍可核对原回执', async () => {
  const user = userEvent.setup()
  const view = mount()
  await user.click(await screen.findByRole('button', { name: '执行实际处理' }))
  await user.selectOptions(screen.getByLabelText('实际处理方式'), 'gifted')
  await screen.findByText('退出后，会影响这些需求')
  await user.type(screen.getByLabelText('原因或说明'), '转赠已确认')
  await user.click(screen.getByLabelText('已核对全部季节影响，确认实际退出'))
  await user.click(screen.getByRole('button', { name: '确认退出衣橱' }))
  await screen.findByText('操作结果尚未确认。刷新不会自动重发。')
  expect(writes).toHaveLength(1)
  view.unmount()
  server.use(
    http.get('/api/v1/organization/:id/exit-impact', () =>
      HttpResponse.json(
        {
          error: { code: 'INVALID_GARMENT', message: '单品已退出' },
          request_id: id,
        },
        { status: 422 },
      ),
    ),
  )
  mount()
  expect(await screen.findByLabelText('实际处理方式')).toHaveValue('gifted')
  expect(screen.getByLabelText('原因或说明')).toHaveValue('转赠已确认')
  expect(writes).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await screen.findByText('整理清单入口')
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1]).toEqual(writes[0])
})
