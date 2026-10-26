import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { useOutfits } from './use-outfits'
import { OutfitsPanel } from './panel'

const sid = '00000000-0000-4000-8000-000000000011'
const jid = '00000000-0000-4000-8000-000000000012'
const envelope = (data: unknown) => ({ data, request_id: '00000000-0000-4000-8000-000000000001' })
const requirements = {
  occasion_codes: [],
  style_codes: null,
  season_codes: [],
  custom_tag_ids: [],
  notes: '今天散步',
  weather_override: { temperature_c: 0, condition: '雪' },
}
const initial = {
  id: sid,
  version: 1,
  requirements,
  selected_revision_id: null,
  locked_garment_ids: [],
  current_job_id: null,
  latest_revision_ids: [],
  revisions: [],
  messages: [],
  invalid_garment_ids: [],
  removed_lock_ids: [],
}
let posts: { body: string; key: string | null }[] = []
const server = setupServer(
  http.get('/api/v1/outfit-sessions/current', () => HttpResponse.json(envelope(initial))),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  posts = []
})
afterAll(() => server.close())
function Harness() {
  const c = useOutfits()
  return (
    <>
      <button disabled={c.busy} onClick={() => c.generate(requirements)}>
        提交本次条件并生成
      </button>
      <OutfitsPanel controller={c} />
    </>
  )
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
it('restores a pending generate request after remount and sends the exact same version and key only on click', async () => {
  let failed = false
  server.use(
    http.patch('/api/v1/outfit-sessions/:id', () =>
      HttpResponse.json(envelope({ ...initial, version: 2 })),
    ),
    http.post('/api/v1/outfit-sessions/:id/generate', async ({ request }) => {
      posts.push({ body: await request.text(), key: request.headers.get('Idempotency-Key') })
      if (!failed) {
        failed = true
        return HttpResponse.error()
      }
      return HttpResponse.json(envelope({ job_id: jid, status: 'queued' }))
    }),
  )
  const user = userEvent.setup()
  const first = mount()
  await waitFor(() => expect(screen.getByText('提交本次条件并生成')).toBeEnabled())
  await user.click(screen.getByText('提交本次条件并生成'))
  await screen.findByRole('alert')
  expect(posts).toHaveLength(1)
  first.unmount()
  mount()
  await screen.findByText('有一项操作尚未确认结果，刷新不会自动重发。')
  expect(posts).toHaveLength(1)
  await user.click(screen.getByText('重发同一搭配操作'))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toEqual(posts[0])
  expect(JSON.parse(posts[1].body).expected_version).toBe(2)
})
it('restoring a terminal job reads results without posting and does not subscribe again', async () => {
  server.use(
    http.get('/api/v1/outfit-sessions/current', () =>
      HttpResponse.json(envelope({ ...initial, current_job_id: jid })),
    ),
    http.get('/api/v1/jobs/:id', () =>
      HttpResponse.json(
        envelope({
          id: jid,
          kind: 'outfit_generate',
          status: 'succeeded',
          error: null,
          last_seq: 4,
          result: {
            session_id: sid,
            revision_ids: [],
            outcome: 'no_match',
            unmet_requirements: ['请先上传衣服'],
            question: null,
          },
        }),
      ),
    ),
    http.post('*', () => {
      throw new Error('Unexpected model submit')
    }),
    http.get('/api/v1/jobs/:id/events', () => {
      throw new Error('Terminal task must not reconnect')
    }),
  )
  const first = mount()
  await screen.findByText('请先上传衣服')
  first.unmount()
  mount()
  await screen.findByText('请先上传衣服')
})
