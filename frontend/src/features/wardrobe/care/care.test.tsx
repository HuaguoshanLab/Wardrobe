import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { garmentSchema } from '../api'
import { CarePage } from './page'
import { initialDraft } from './state'
import type { CareBatch } from './api'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const garment = (n: number) =>
  garmentSchema.parse({
    id: id(n),
    image_asset_id: id(99),
    version: 1,
    created_at: '2026-10-30T00:00:00Z',
    image_url: '/test.png',
    has_cutout: false,
    is_demo: false,
    name: `单品 ${n}`,
    category: 'top',
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
const envelope = (data: unknown) => ({ data, request_id: id(99) })
let reads: string[] = []
let writes: { key: string | null; body: CareBatch }[] = []
let lose = false
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(envelope({ version: 1, fields: { category: { top: '上衣' } } })),
  ),
  http.get('/api/v1/tags', () =>
    HttpResponse.json(envelope([{ id: id(90), name: '日常', version: 1 }])),
  ),
  http.get('/api/v1/wardrobe/care', ({ request }) => {
    const url = new URL(request.url)
    reads.push(url.search)
    return HttpResponse.json(
      envelope({
        items: url.searchParams.get('q')
          ? []
          : url.searchParams.get('cursor')
            ? [garment(3)]
            : [garment(1), garment(2)],
        next_cursor: url.searchParams.get('cursor') ? null : id(2),
      }),
    )
  }),
  http.get('/api/v1/garments/:gid', ({ params }) =>
    HttpResponse.json(envelope({ ...garment(Number(String(params.gid).slice(-12))), version: 2 })),
  ),
  http.post('/api/v1/wardrobe/care/actions', async ({ request }) => {
    const body = (await request.json()) as CareBatch
    writes.push({ key: request.headers.get('Idempotency-Key'), body })
    if (lose) {
      lose = false
      return HttpResponse.error()
    }
    return HttpResponse.json(
      envelope({
        items: body.items.map((i, n) => ({
          id: i.id,
          garment_id: i.garment_id,
          success: n === 0,
          changed: n === 0,
          code: n === 0 ? 'UPDATED' : 'STATE_CONFLICT',
          message: n === 0 ? '已完成' : '已改为维修',
          garment: n === 0 ? garment(1) : null,
        })),
      }),
    )
  }),
)
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  server.listen({ onUnhandledRequest: 'error' })
})
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  reads = []
  writes = []
  lose = false
})
function mount(path = '/') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <CarePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
it('keeps explicit cross-page selection through filters and reload without sending', async () => {
  const user = userEvent.setup()
  const view = mount()
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 1' }))
  await user.click(screen.getByRole('button', { name: '加载更多单品' }))
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 3' }))
  await user.type(screen.getByLabelText('搜索单品'), '不存在')
  await screen.findByText('没有符合条件的单品')
  await user.click(screen.getByRole('button', { name: '只看已选（2）' }))
  expect(screen.getByRole('checkbox', { name: '选择：单品 1' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '选择：单品 3' })).toBeChecked()
  expect(screen.queryByRole('checkbox', { name: '选择：单品 2' })).not.toBeInTheDocument()
  view.unmount()
  mount()
  await screen.findByRole('button', { name: '只看已选（2）' })
  expect(writes).toEqual([])
})
it('rechecks current versions, recovers the exact request after a lost response and keeps only failures', async () => {
  const user = userEvent.setup()
  let view = mount()
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 1' }))
  await user.click(screen.getByRole('checkbox', { name: '选择：单品 2' }))
  await user.selectOptions(screen.getByLabelText('批量操作'), 'mark_washing')
  await user.click(screen.getByRole('button', { name: '核对并继续' }))
  await screen.findAllByText('资料已更新，本次按以上最新状态确认。')
  expect(writes).toHaveLength(0)
  lose = true
  await user.click(screen.getByRole('button', { name: '确认对 2 件执行' }))
  await screen.findByRole('alert')
  expect(writes).toHaveLength(1)
  expect(writes[0].body.items.every((i) => i.expected_version === 2)).toBe(true)
  view.unmount()
  view = mount()
  await screen.findByRole('button', { name: '重发原批量请求' })
  expect(writes).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发原批量请求' }))
  await screen.findByText('成功 1 件，未成功 1 件')
  expect(writes[1]).toEqual(writes[0])
  await user.click(screen.getByRole('button', { name: '只看已选（1）' }))
  expect(screen.getByRole('checkbox', { name: '选择：单品 2' })).toBeChecked()
  expect(screen.queryByRole('checkbox', { name: '选择：单品 1' })).not.toBeInTheDocument()
  expect(localStorage.getItem('wardrobe.care.pending')).toBeNull()
  const results = screen.getByRole('region', { name: '批量操作结果' })
  expect(results.querySelector('details')).not.toHaveAttribute('open')
  expect(results).toHaveTextContent('已改为维修')
  await user.selectOptions(screen.getByLabelText('批量操作'), 'location_clear')
  await user.click(screen.getByRole('button', { name: '只选未成功项，重新核对' }))
  expect(screen.getByLabelText('批量操作')).toHaveValue('mark_washing')
  expect(screen.getByLabelText('批量操作')).toHaveFocus()
  expect(writes).toHaveLength(2)
})
it('enforces explicit 20-item selection without silently selecting the rest', async () => {
  localStorage.setItem(
    'wardrobe.care.draft',
    JSON.stringify({
      ...initialDraft,
      selected: Array.from({ length: 20 }, (_, i) => garment(i + 2)),
    }),
  )
  const user = userEvent.setup()
  mount()
  expect(await screen.findByRole('checkbox', { name: '选择：单品 1' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: '选择：单品 2' }))
  expect(screen.getByRole('checkbox', { name: '选择：单品 1' })).toBeEnabled()
  await user.click(screen.getByRole('checkbox', { name: '选择：单品 1' }))
  expect(JSON.parse(localStorage.getItem('wardrobe.care.draft')!).selected).toHaveLength(20)
  expect(writes).toEqual([])
})
it('requires a nonblank location and handles clear as a separate confirmed action', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 1' }))
  await user.selectOptions(screen.getByLabelText('批量操作'), 'location_set')
  await user.type(screen.getByLabelText('新收纳位置'), '  ')
  expect(screen.getByRole('button', { name: '核对并继续' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('批量操作'), 'location_clear')
  await user.click(screen.getByRole('button', { name: '核对并继续' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '确认对 1 件执行' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '确认对 1 件执行' }))
  await screen.findByText('成功 1 件，未成功 0 件')
  expect(writes[0].body.items[0]).toMatchObject({
    action: 'location_clear',
    location: null,
    tag_ids: [],
  })
})

it('shows the current repair conflict and intended change before any write', async () => {
  const g = garment(1)
  server.use(
    http.get('/api/v1/garments/:gid', () =>
      HttpResponse.json(
        envelope({
          ...g,
          version: 3,
          availability: 'unavailable',
          lifecycle: { ...g.lifecycle, unavailable_reason: 'repair' },
        }),
      ),
    ),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 1' }))
  await user.click(screen.getByRole('button', { name: '核对并继续' }))
  await screen.findByText('当前不是待洗状态，不会恢复可穿。')
  expect(screen.getByText('目标：可穿')).toBeVisible()
  expect(screen.getByText(/其中 1 件当前无法执行/)).toBeVisible()
  expect(writes).toEqual([])
})

it('previews location changes and returns focus to the editor without clearing selection', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 1' }))
  await user.click(screen.getByRole('button', { name: '更改操作' }))
  expect(screen.getByLabelText('批量操作')).toHaveFocus()
  await user.selectOptions(screen.getByLabelText('批量操作'), 'location_set')
  await user.type(screen.getByLabelText('新收纳位置'), '衣柜三层')
  await user.click(screen.getByRole('button', { name: '核对并继续' }))
  await screen.findByText('新位置：衣柜三层')
  expect(writes).toEqual([])
})

it('uses the available-group default only when there is no saved draft', async () => {
  const user = userEvent.setup()
  const view = mount('/wardrobe/care?group=available')
  expect(screen.getByLabelText('批量操作')).toHaveValue('mark_washing')
  await user.selectOptions(screen.getByLabelText('批量操作'), 'location_clear')
  view.unmount()
  mount('/wardrobe/care?group=available')
  expect(screen.getByLabelText('批量操作')).toHaveValue('location_clear')
})
it('names the item that cannot be read and blocks submission until it is resolved', async () => {
  server.use(
    http.get('/api/v1/garments/:gid', () =>
      HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: '衣服已删除' }, request_id: id(99) },
        { status: 404 },
      ),
    ),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('checkbox', { name: '选择：单品 1' }))
  await user.click(screen.getByRole('button', { name: '核对并继续' }))
  await screen.findByText(/单品 1：/)
  expect(screen.getByRole('button', { name: '确认对 1 件执行' })).toBeDisabled()
  expect(writes).toEqual([])
})
