import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { OutfitActions } from './outfit-actions'
import type { Revision } from '../outfits'

const id = '00000000-0000-4000-8000-000000000001'
const revision: Revision = {
  id,
  session_id: id,
  parent_revision_id: null,
  run_id: id,
  reason: '',
  unmet_requirements: [],
  weather_snapshot: {},
  request_snapshot: {},
  provider_mode: 'fake',
  created_at: '2026-10-28T00:00:00Z',
  items: [],
}
const writes: { path: string; body: unknown; key: string | null }[] = []
const server = setupServer(
  http.post('/api/v1/:kind', async ({ request, params }) => {
    writes.push({
      path: String(params.kind),
      body: await request.json(),
      key: request.headers.get('Idempotency-Key'),
    })
    return HttpResponse.json({ data: { id }, request_id: id })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  writes.length = 0
})
afterAll(() => server.close())
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OutfitActions revision={revision} />
    </QueryClientProvider>,
  )
}
it('opening and dismissing record sheets is read-only; collecting never records wear', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '记录穿着' }))
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await user.click(screen.getByRole('button', { name: '收藏' }))
  expect(writes).toHaveLength(0)
  await user.type(screen.getByLabelText('收藏名称（选填）'), '通勤')
  await user.click(screen.getByRole('button', { name: '确认收藏' }))
  await screen.findByText('已收藏这套搭配')
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ path: 'favorites', body: { revision_id: id, name: '通勤' } })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
it('wear confirmation uses the displayed revision and date, independently of selecting or collecting', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '记录穿着' }))
  await user.clear(screen.getByLabelText('实际穿着日期'))
  await user.type(screen.getByLabelText('实际穿着日期'), '2026-10-20')
  await user.type(screen.getByLabelText('穿着备注（选填）'), '很舒适')
  await user.click(screen.getByRole('button', { name: '确认记录穿着' }))
  await screen.findByText('穿着记录已保存')
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    path: 'wear-records',
    body: { revision_id: id, worn_on: '2026-10-20', notes: '很舒适' },
  })
})
it('an ambiguous save stays recoverable after closing and remounting with its original key and body', async () => {
  let first = true
  server.use(
    http.post('/api/v1/favorites', async ({ request }) => {
      writes.push({
        path: 'favorites',
        body: await request.json(),
        key: request.headers.get('Idempotency-Key'),
      })
      if (first) {
        first = false
        return HttpResponse.error()
      }
      return HttpResponse.json({ data: { id }, request_id: id })
    }),
  )
  const user = userEvent.setup()
  const view = mount()
  await user.click(screen.getByRole('button', { name: '收藏' }))
  await user.type(screen.getByLabelText('收藏名称（选填）'), '原始名称')
  await user.click(screen.getByRole('button', { name: '确认收藏' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('dialog')).toBeVisible()
  view.unmount()
  mount()
  expect(writes).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await screen.findByText('已收藏这套搭配')
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
})
