import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { FeedbackEditor } from './editor'
import { emptyFeedback, feedbackText, type FeedbackView } from './api'
import { wearSchema } from '../api'
import { FeedbackPreference } from '../../profile'

const id = '00000000-0000-4000-8000-000000000001'
const wear = wearSchema.parse({
  id,
  revision_id: id,
  worn_on: '2026-10-30',
  timezone: 'Asia/Shanghai',
  notes: '',
  version: 1,
  created_at: '2026-10-30T00:00:00Z',
  revision: {
    id,
    source: 'manual',
    session_id: null,
    run_id: null,
    provider_mode: null,
    parent_revision_id: null,
    items: [],
    reason: '',
    unmet_requirements: [],
    weather_snapshot: {},
    request_snapshot: {},
    created_at: '2026-10-30T00:00:00Z',
  },
})
const initial: FeedbackView = { wear_record_id: id, version: 0, feedback: null, updated_at: null }
const prefs = {
  version: 4,
  preferences: {
    notes: '保留原偏好',
    style_codes: [],
    fit: null,
    thermal: 'cold_sensitive',
    preferred_colors: [],
    avoided_colors: [],
  },
}
let writes: { key: string | null; body: unknown }[] = []
let failed = false
const envelope = (data: unknown) => ({ data, request_id: id })
const server = setupServer(
  http.get('/api/v1/profile/preferences', () => HttpResponse.json(envelope(prefs))),
  http.patch(`/api/v1/wear-records/${id}/feedback`, async ({ request }) => {
    const body = (await request.json()) as { feedback: typeof emptyFeedback }
    writes.push({ key: request.headers.get('Idempotency-Key'), body })
    return failed
      ? HttpResponse.error()
      : HttpResponse.json(envelope({ ...initial, version: 1, feedback: body.feedback }))
  }),
  http.patch('/api/v1/profile/preferences', async ({ request }) => {
    writes.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() })
    return failed ? HttpResponse.error() : HttpResponse.json(envelope({ ...prefs, version: 5 }))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  writes = []
  failed = false
})
afterAll(() => server.close())
function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}
it('keeps draft on refresh, saves feedback only and restores the exact failed operation', async () => {
  const user = userEvent.setup()
  let mounted = wrap(<FeedbackEditor wear={wear} initial={initial} reload={async () => initial} />)
  expect(screen.getByRole('button', { name: '用于下次搭配' })).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: '偏热' }))
  await user.type(screen.getByLabelText('感受备注（可选）'), '午后有点闷')
  mounted.unmount()
  mounted = wrap(<FeedbackEditor wear={wear} initial={initial} reload={async () => initial} />)
  expect(screen.getByLabelText('感受备注（可选）')).toHaveValue('午后有点闷')
  failed = true
  await user.click(screen.getByRole('button', { name: '保存反馈' }))
  await screen.findByRole('button', { name: '重发同一操作' })
  mounted.unmount()
  wrap(<FeedbackEditor wear={wear} initial={initial} reload={async () => initial} />)
  expect(writes).toHaveLength(1)
  failed = false
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await screen.findByText('反馈已保存，尚未修改长期偏好。')
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
  expect(screen.getByRole('button', { name: '用于下次搭配' })).toBeEnabled()
})
it('requires explicit preference confirmation, preserves prior text, and retries the same payload', async () => {
  const user = userEvent.setup()
  const mounted = wrap(<FeedbackPreference text="这次偏热" />)
  await screen.findByLabelText('长期偏好补充')
  expect(writes).toHaveLength(0)
  expect(screen.getByLabelText('长期偏好补充')).toHaveValue('保留原偏好\n这次偏热')
  failed = true
  await user.click(screen.getByRole('button', { name: '确认保存长期偏好' }))
  await screen.findByRole('button', { name: '重发同一操作' })
  mounted.unmount()
  wrap(<FeedbackPreference text="不同的新文字" />)
  expect(writes).toHaveLength(1)
  failed = false
  await user.click(screen.getByRole('button', { name: '重发同一操作' }))
  await screen.findByText('偏好已保存。已保存的穿后反馈独立保留。')
  expect(writes[1]).toEqual(writes[0])
  expect(writes[0].body).toEqual({
    expected_version: 4,
    preferences: { notes: '保留原偏好\n这次偏热' },
  })
})
it('does not infer a global thermal trait or truncate a long preference', async () => {
  const text = feedbackText({ ...emptyFeedback, thermal: 'hot' }, '这件上衣', '2026-10-30')
  expect(text).toContain('2026-10-30')
  expect(text).toContain('偏热')
  expect(text).not.toContain('怕热')
  wrap(<FeedbackPreference text={'长'.repeat(1000)} />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '确认保存长期偏好' })).toBeDisabled(),
  )
  expect(writes).toHaveLength(0)
})

it('clears a feeling back to unknown without clearing other input or submitting', async () => {
  const user = userEvent.setup()
  wrap(<FeedbackEditor wear={wear} initial={initial} reload={async () => initial} />)
  await user.click(screen.getByRole('radio', { name: '偏热' }))
  await user.type(screen.getByLabelText('感受备注（可选）'), '走路很多')
  await user.click(screen.getByRole('button', { name: '清除冷热感受' }))
  expect(screen.getByRole('radio', { name: '偏热' })).not.toBeChecked()
  expect(screen.getByLabelText('感受备注（可选）')).toHaveValue('走路很多')
  expect(writes).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '保存反馈' }))
  await screen.findByText('反馈已保存，尚未修改长期偏好。')
  expect(writes[0].body).toMatchObject({ feedback: { thermal: null, notes: '走路很多' } })
})

it('keeps independent edited previews when switching uses, and blocks use while feedback is dirty', async () => {
  const user = userEvent.setup()
  const saved = { ...initial, version: 1, feedback: { ...emptyFeedback, thermal: 'hot' as const } }
  wrap(<FeedbackEditor wear={wear} initial={saved} reload={async () => saved} />)
  await user.click(screen.getByRole('button', { name: '用于下次搭配' }))
  await user.clear(screen.getByLabelText('下次搭配参考'))
  await user.type(screen.getByLabelText('下次搭配参考'), '下次想穿轻薄一些')
  await user.click(screen.getByRole('button', { name: '保存为长期偏好' }))
  await screen.findByLabelText('长期偏好补充')
  await user.clear(screen.getByLabelText('长期偏好补充'))
  await user.type(screen.getByLabelText('长期偏好补充'), '长期偏好由我核对')
  await user.click(screen.getByRole('button', { name: '用于下次搭配' }))
  expect(screen.getByLabelText('下次搭配参考')).toHaveValue('下次想穿轻薄一些')
  await user.click(screen.getByRole('button', { name: '保存为长期偏好' }))
  expect(screen.getByLabelText('长期偏好补充')).toHaveValue('长期偏好由我核对')
  await user.click(screen.getByRole('radio', { name: '偏冷' }))
  expect(screen.getByRole('button', { name: '确认保存长期偏好' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '用于下次搭配' })).toBeDisabled()
  expect(writes).toHaveLength(0)
})
