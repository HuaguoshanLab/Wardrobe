import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { Diagnostics } from './diagnostics'

const id = '00000000-0000-4000-8000-000000000002'
const envelope = (data: unknown) => ({ data, request_id: id })
let postKeys: (string | null)[] = []
const server = setupServer(
  http.get('/api/v1/capabilities', () =>
    HttpResponse.json(
      envelope({
        provider_mode: 'fake',
        model: 'fake',
        recognition: 'fake',
        weather: 'unimplemented',
        cutout: 'unimplemented',
        maintenance: false,
        data_epoch: id,
      }),
    ),
  ),
  http.get('/api/v1/jobs/:id', () =>
    HttpResponse.json(
      envelope({
        id,
        kind: 'diagnostic',
        status: 'succeeded',
        result: { provider_mode: 'fake', message: '已恢复原任务' },
        error: null,
        retry_of_job_id: null,
        last_seq: 5,
        created_at: '2026-10-26T00:00:00Z',
        updated_at: '2026-10-26T00:00:00Z',
      }),
    ),
  ),
  http.post('/api/v1/diagnostics/jobs', ({ request }) => {
    postKeys.push(request.headers.get('Idempotency-Key'))
    return HttpResponse.json(envelope({ job_id: id, status: 'queued' }), { status: 202 })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  postKeys = []
})
afterAll(() => server.close())

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Diagnostics />
    </QueryClientProvider>,
  )
}

it('refresh restores a task without creating another', async () => {
  localStorage.setItem(
    'wardrobe.diagnostic',
    JSON.stringify({ key: 'original-key', message: 'original', jobId: id }),
  )
  mount()
  expect(await screen.findByText('已恢复原任务')).toBeInTheDocument()
  expect(postKeys).toHaveLength(0)
})

it('ambiguous network failure resends exactly the same operation key', async () => {
  let first = true
  server.use(
    http.post('/api/v1/diagnostics/jobs', ({ request }) => {
      postKeys.push(request.headers.get('Idempotency-Key'))
      if (first) {
        first = false
        return HttpResponse.error()
      }
      return HttpResponse.json(envelope({ job_id: id, status: 'queued' }), { status: 202 })
    }),
  )
  mount()
  const user = userEvent.setup()
  const run = screen.getByRole('button', { name: '运行模拟任务' })
  await waitFor(() => expect(run).toBeEnabled())
  await user.click(run)
  const resend = await screen.findByRole('button', { name: '重发同一操作' })
  await waitFor(() => expect(resend).toBeEnabled())
  await user.click(resend)
  expect(await screen.findByText('已恢复原任务')).toBeInTheDocument()
  expect(postKeys).toHaveLength(2)
  expect(postKeys[0]).toBe(postKeys[1])
})
