import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { BackupPanel } from './panel'

const rid = '00000000-0000-4000-8000-000000000051'
const envelope = (data: unknown) => ({ data, request_id: '00000000-0000-4000-8000-000000000001' })
let posts: { body: string; key: string | null }[] = []
const server = setupServer(
  http.get('/api/v1/restores/:id', () =>
    HttpResponse.json(
      envelope({
        restore_id: rid,
        status: 'ready',
        message: '验证通过',
        sha256: 'abc',
        confirmation_token: 'confirmation-token-1234',
        expires_at: '2099-01-01T00:00:00Z',
        target_data_epoch: rid,
        summary: { garments: 3 },
        job_id: null,
      }),
    ),
  ),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  posts = []
  localStorage.clear()
})
afterAll(() => server.close())
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <BackupPanel />
    </QueryClientProvider>,
  )
}
it('requires explicit confirmation and preserves the exact apply request after a network failure and remount', async () => {
  localStorage.setItem('wardrobe-control.restore', rid)
  server.use(
    http.post('/api/v1/restores/:id/apply', async ({ request }) => {
      posts.push({ body: await request.text(), key: request.headers.get('Idempotency-Key') })
      return posts.length === 1
        ? HttpResponse.error()
        : HttpResponse.json(envelope({ job_id: rid, status: 'queued' }))
    }),
  )
  const user = userEvent.setup()
  const first = mount()
  await user.click(await screen.findByRole('button', { name: '检查并恢复' }))
  const button = await screen.findByRole('button', { name: '确认覆盖恢复' })
  expect(button).toBeDisabled()
  expect(posts).toHaveLength(0)
  await user.click(screen.getByRole('checkbox'))
  await user.click(button)
  await screen.findByRole('alert')
  expect(posts).toHaveLength(1)
  first.unmount()
  mount()
  await screen.findByText('操作结果尚未确认。刷新不会自动重发。')
  expect(posts).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[0]).toEqual(posts[1])
})
