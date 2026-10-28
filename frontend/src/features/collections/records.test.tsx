import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { CollectionsPage, CalendarPage } from './pages'
import { RevisionPage } from './revision'
import { monthDays } from './calendar'
import { today, type Favorite, type Wear } from './api'
import type { Revision } from '../outfits'

const id = '00000000-0000-4000-8000-000000000001'
const second = '00000000-0000-4000-8000-000000000002'
const revision: Revision = {
  id,
  session_id: id,
  parent_revision_id: null,
  run_id: id,
  items: [],
  reason: '保存时的说明',
  unmet_requirements: [],
  weather_snapshot: {},
  request_snapshot: {},
  provider_mode: 'fake',
  created_at: '2026-10-01T00:00:00Z',
}
const envelope = (data: unknown) => ({ data, request_id: id })
let favorites: Favorite[] = []
let wears: Wear[] = []
let hidden = false
let writes: {
  path: string
  method: string
  body: unknown
  version: string | null
  key: string | null
}[] = []
const server = setupServer(
  http.get('/api/v1/outfit-revisions', () =>
    HttpResponse.json(
      envelope({
        items: hidden ? [] : [{ revision, version: 3, hidden_from_history_at: null }],
        next_cursor: null,
      }),
    ),
  ),
  http.get('/api/v1/outfit-revisions/:id', () => HttpResponse.json(envelope(revision))),
  http.get('/api/v1/favorites', () =>
    HttpResponse.json(envelope({ items: favorites, next_cursor: null })),
  ),
  http.get('/api/v1/wear-records', () =>
    HttpResponse.json(envelope({ items: wears, next_cursor: null })),
  ),
  http.get('/api/v1/taxonomies', () => HttpResponse.json(envelope({ version: 1, fields: {} }))),
  http.all('/api/v1/*', async ({ request }) => {
    writes.push({
      path: new URL(request.url).pathname,
      method: request.method,
      body: request.method === 'DELETE' ? null : await request.json(),
      version: request.headers.get('If-Match'),
      key: request.headers.get('Idempotency-Key'),
    })
    if (request.method === 'DELETE') hidden = true
    return HttpResponse.json(envelope({ deleted: true }))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  favorites = []
  wears = []
  hidden = false
  writes = []
  sessionStorage.clear()
})
afterAll(() => server.close())
function mount(path = '/collections?view=history') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      { path: '/collections', element: <CollectionsPage /> },
      { path: '/calendar', element: <CalendarPage /> },
      { path: '/collections/:revisionId', element: <RevisionPage /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}
it('calendar constructs real leap-year dates and Monday-first offset', () => {
  const days = monthDays('2024-02')
  expect(days.slice(0, 3)).toEqual([null, null, null])
  expect(days.at(-1)).toBe('2024-02-29')
  expect(monthDays('2025-02').at(-1)).toBe('2025-02-28')
})
it('legacy calendar redirects and same-day records remain separate without writes', async () => {
  wears = [id, second].map((key) => ({
    id: key,
    revision_id: key,
    worn_on: today(),
    timezone: 'Asia/Shanghai',
    notes: '',
    version: 1,
    created_at: '',
    revision: { ...revision, id: key },
  }))
  const router = mount('/calendar')
  await screen.findByRole('button', { name: `${today()}，2 套穿着` })
  expect(await screen.findAllByRole('link', { name: '查看搭配：一套搭配' })).toHaveLength(2)
  expect(router.state.location.search).toBe('?view=calendar')
  expect(writes).toHaveLength(0)
})
it('detail finds favorites beyond the first page and returns to the original subtab', async () => {
  const favorite = { id, revision_id: id, name: '通勤收藏', version: 2, created_at: '', revision }
  server.use(
    http.get('/api/v1/favorites', ({ request }) =>
      HttpResponse.json(
        envelope(
          new URL(request.url).searchParams.has('cursor')
            ? { items: [favorite], next_cursor: null }
            : { items: [], next_cursor: second },
        ),
      ),
    ),
  )
  const user = userEvent.setup()
  const router = mount('/collections?view=favorites')
  await user.click(await screen.findByRole('link', { name: '查看搭配：通勤收藏' }))
  await screen.findByRole('button', { name: '已收藏 · 改名' })
  await user.click(screen.getByRole('link', { name: '返回穿搭记录' }))
  expect(router.state.location.search).toBe('?view=favorites')
  expect(writes).toHaveLength(0)
})
it('history removal explains separate references and sends the displayed version only after confirmation', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: '更多搭配操作' }))
  await user.click(screen.getByRole('button', { name: '从历史移除' }))
  await screen.findByText(/收藏、穿着记录和原始快照仍保留/)
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '确认从历史移除' }))
  await screen.findByRole('heading', { name: '第一套搭配，从今天开始' })
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    path: `/api/v1/outfit-revisions/${id}`,
    method: 'DELETE',
    version: '3',
  })
  expect(writes[0].key).toBeTruthy()
})
it('favorite rename retains draft when closing and disables saving unchanged values', async () => {
  favorites = [{ id, revision_id: id, name: '原名', version: 2, created_at: '', revision }]
  const user = userEvent.setup()
  mount(`/collections/${id}`)
  await user.click(await screen.findByRole('button', { name: '已收藏 · 改名' }))
  expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
  await user.type(screen.getByLabelText('收藏名称（选填）'), '新')
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await user.click(await screen.findByRole('button', { name: '继续编辑' }))
  expect(screen.getByLabelText('收藏名称（选填）')).toHaveValue('原名新')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0].body).toEqual({ expected_version: 2, name: '原名新' })
})
it('recording wear rejects future dates without marking a favorite', async () => {
  const user = userEvent.setup()
  mount(`/collections/${id}`)
  await user.click(await screen.findByRole('button', { name: '记录穿着' }))
  const dialog = screen.getByRole('dialog')
  await user.clear(within(dialog).getByLabelText('实际穿着日期'))
  await user.type(within(dialog).getByLabelText('实际穿着日期'), '2099-12-31')
  expect(screen.getByRole('button', { name: '确认记录穿着' })).toBeDisabled()
  expect(writes).toHaveLength(0)
})

it('conflict recovery keeps edited notes and reads the latest untouched date and version', async () => {
  wears = [
    {
      id,
      revision_id: id,
      worn_on: today(),
      timezone: 'Asia/Shanghai',
      notes: '原备注',
      version: 1,
      created_at: '',
      revision,
    },
  ]
  let submitted: unknown
  server.use(
    http.patch('/api/v1/wear-records/:id', async ({ request }) => {
      const body = (await request.json()) as { expected_version: number }
      if (body.expected_version === 1) {
        wears[0] = { ...wears[0], version: 2, worn_on: '2026-10-01' }
        return HttpResponse.json(
          { error: { code: 'VERSION_CONFLICT', message: '记录已更新' } },
          { status: 409 },
        )
      }
      submitted = body
      return HttpResponse.json(envelope({ id }))
    }),
  )
  const user = userEvent.setup()
  mount('/collections?view=calendar')
  await user.click(await screen.findByRole('button', { name: '编辑记录' }))
  await user.clear(screen.getByLabelText('穿着备注（选填）'))
  await user.type(screen.getByLabelText('穿着备注（选填）'), '保留这段修改')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await user.click(await screen.findByRole('button', { name: '放弃待发操作并刷新' }))
  await waitFor(() => expect(screen.getByLabelText('实际穿着日期')).toHaveValue('2026-10-01'))
  expect(screen.getByLabelText('穿着备注（选填）')).toHaveValue('保留这段修改')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() =>
    expect(submitted).toEqual({
      expected_version: 2,
      worn_on: '2026-10-01',
      notes: '保留这段修改',
    }),
  )
})

it('backfilling from a selected day carries the date into the wear form', async () => {
  const user = userEvent.setup()
  mount('/collections?view=history&record_on=2026-10-01')
  await user.click(await screen.findByRole('button', { name: '记录穿着' }))
  expect(screen.getByLabelText('实际穿着日期')).toHaveValue('2026-10-01')
  expect(writes).toHaveLength(0)
})
