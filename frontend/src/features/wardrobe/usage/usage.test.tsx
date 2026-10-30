import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { UsagePage } from './page'

const id = '00000000-0000-4000-8000-000000000001'
const requests: URL[] = []
let empty = false
let pendingRead: Promise<void> | null = null
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json({
      data: { version: 1, fields: { category: { top: '上衣' } } },
      request_id: id,
    }),
  ),
  http.get('/api/v1/wardrobe/usage', async ({ request }) => {
    const url = new URL(request.url)
    requests.push(url)
    if (pendingRead) await pendingRead
    const offset = Number(url.searchParams.get('offset'))
    const range = url.searchParams.get('range')
    const view = url.searchParams.get('view')
    return HttpResponse.json({
      data: {
        range,
        view,
        offset,
        limit: 20,
        as_of: '2026-10-30',
        window_start: '2026-10-01',
        timezone: 'Asia/Shanghai',
        total_garments: empty ? 0 : 500,
        recorded_garments: empty ? 0 : 50,
        unrecorded_garments: empty ? 0 : 450,
        recorded_ratio: empty ? null : 0.1,
        total_items: empty ? 0 : 50,
        next_offset: empty || offset ? null : 20,
        items: empty
          ? []
          : [
              {
                garment_id: id,
                name: `第 ${offset + 1} 件`,
                category: 'top',
                image_url: null,
                availability: view === 'worn' ? 'available' : 'unavailable',
                created_at: '2026-10-29T00:00:00Z',
                wear_days: view === 'worn' ? 2 : 0,
                last_worn_on: view === 'worn' ? '2026-10-29' : null,
              },
            ],
      },
      request_id: id,
    })
  }),
)
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  Element.prototype.scrollIntoView = vi.fn()
})
afterAll(() => server.close())
afterEach(() => {
  requests.length = 0
  empty = false
  pendingRead = null
  server.resetHandlers()
})
function mount(path = '/wardrobe/usage') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <UsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
it('uses full server totals and resets pagination when changing range or view', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByText('50 / 500 件当前衣服')
  expect(screen.getByText('10%')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下一页' }))
  await screen.findByText('第 21 件')
  expect(screen.getByRole('heading', { name: '常穿单品' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '近 90 天' }))
  await screen.findByText('第 1 件')
  expect(requests.at(-1)?.searchParams.get('range')).toBe('90')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  await user.click(screen.getByRole('button', { name: '期间无记录 · 450' }))
  await screen.findByRole('link', { name: '查看可用状态' })
  expect(screen.queryByRole('link', { name: '围绕这件搭配' })).not.toBeInTheDocument()
})
it('does not show a fabricated percentage for an empty wardrobe', async () => {
  empty = true
  mount('/wardrobe/usage?range=all')
  await screen.findByText('先把衣服放进衣橱')
  expect(document.querySelector('.usage-ratio')).toHaveTextContent('—')
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
})
it('keeps the selected range on failure and retries explicitly', async () => {
  let failed = true
  server.use(
    http.get('/api/v1/wardrobe/usage', () =>
      failed ? HttpResponse.error() : HttpResponse.json({ data: {}, request_id: id }),
    ),
  )
  const user = userEvent.setup()
  mount('/wardrobe/usage?range=90&view=unrecorded&offset=20')
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '近 90 天' })).toHaveAttribute('aria-pressed', 'true')
  failed = false
  server.resetHandlers()
  await user.click(screen.getByRole('button', { name: '重新读取利用情况' }))
  await screen.findByText('第 21 件')
  expect(requests.at(-1)?.searchParams.get('view')).toBe('unrecorded')
})

it('preserves filter focus while loading and never labels old totals as the new range', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByText('50 / 500 件当前衣服')
  let release!: () => void
  pendingRead = new Promise<void>((resolve) => {
    release = resolve
  })
  const filter = screen.getByRole('button', { name: '期间无记录 · 450' })
  await user.click(filter)
  await waitFor(() => expect(requests.at(-1)?.searchParams.get('view')).toBe('unrecorded'))
  expect(filter).toHaveFocus()
  expect(filter).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByText('50 / 500 件当前衣服')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('正在读取所选范围')
  release()
  await screen.findByRole('link', { name: '查看可用状态' })
  expect(filter).toHaveFocus()
})
