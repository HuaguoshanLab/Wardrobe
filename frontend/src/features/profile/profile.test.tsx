import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { ConditionsPanel } from './conditions'
import { PreferencesPanel } from './preferences'
import { preferencesSchema, type Requirements } from './api'

const envelope = (data: unknown) => ({ data, request_id: '00000000-0000-4000-8000-000000000001' })
const prefs = {
  style_codes: ['casual'],
  fit: null,
  thermal: null,
  preferred_colors: [],
  avoided_colors: [],
  notes: null,
}
let requests: Requirements[] = []
let keys: (string | null)[] = []
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({
        version: 1,
        fields: {
          style_codes: { casual: '休闲', elegant: '优雅' },
          color_codes: {},
          seasons: {},
          occasion_codes: {},
        },
      }),
    ),
  ),
  http.get('/api/v1/tags', () => HttpResponse.json(envelope([]))),
  http.get('/api/v1/profile/preferences', () =>
    HttpResponse.json(envelope({ preferences: prefs, version: 1 })),
  ),
  http.post('/api/v1/conditions/preview', async ({ request }) => {
    const body = (await request.json()) as Requirements
    requests.push(body)
    return HttpResponse.json(
      envelope({
        requirements: body,
        effective_preferences: { ...prefs, style_codes: body.style_codes ?? prefs.style_codes },
        preference_version: 1,
      }),
    )
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests = []
  keys = []
})
afterAll(() => server.close())
function mount(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    client,
    ...render(<QueryClientProvider client={client}>{component}</QueryClientProvider>),
  }
}

it('manual zero and explicit empty style survive reload without posting', async () => {
  const user = userEvent.setup()
  const view = mount(<ConditionsPanel storageKey="wardrobe.test.conditions" />)
  await user.click(screen.getByText(/^更多条件/))
  await user.selectOptions(screen.getByLabelText('风格来源'), 'override')
  await user.selectOptions(screen.getByLabelText('天气来源'), 'manual')
  await user.type(screen.getByLabelText('手动温度（℃）'), '0')
  await user.type(screen.getByLabelText('天气现象'), '下雪')
  await user.click(screen.getByRole('button', { name: '保存并核对条件' }))
  await screen.findByText('手动天气：0℃ · 下雪')
  expect(requests[0].style_codes).toEqual([])
  expect(requests[0].weather_override?.temperature_c).toBe(0)
  view.unmount()
  mount(<ConditionsPanel storageKey="wardrobe.test.conditions" />)
  expect(screen.getByLabelText('手动温度（℃）')).toHaveValue(0)
  expect(requests).toHaveLength(1)
})

it('preference drafts survive background refresh and ambiguous retry reuses key', async () => {
  let first = true
  server.use(
    http.patch('/api/v1/profile/preferences', async ({ request }) => {
      keys.push(request.headers.get('Idempotency-Key'))
      if (first) {
        first = false
        return HttpResponse.error()
      }
      const data = (await request.json()) as { preferences: unknown }
      return HttpResponse.json(
        envelope({ preferences: preferencesSchema.parse(data.preferences), version: 2 }),
      )
    }),
  )
  const user = userEvent.setup()
  const view = mount(<PreferencesPanel />)
  await user.type(await screen.findByLabelText('偏好补充'), '保留输入')
  view.client.setQueryData(['preferences'], {
    preferences: { ...prefs, notes: '后台新值' },
    version: 2,
  })
  expect(screen.getByLabelText('偏好补充')).toHaveValue('保留输入')
  await user.click(screen.getByRole('button', { name: '保存偏好' }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: '重发原保存操作' }))
  await waitFor(() => expect(keys).toHaveLength(2))
  expect(keys[0]).toBe(keys[1])
  await screen.findByText('偏好已保存')
})

it('removes deleted draft tags while preserving valid tags, notes and zero weather', async () => {
  const valid = '00000000-0000-4000-8000-000000000010'
  const deleted = '00000000-0000-4000-8000-000000000011'
  server.use(
    http.get('/api/v1/tags', () =>
      HttpResponse.json(envelope([{ id: valid, name: '通勤', version: 1 }])),
    ),
  )
  localStorage.setItem(
    'tag-draft',
    JSON.stringify({
      requirements: {
        occasion_codes: [],
        style_codes: null,
        season_codes: [],
        custom_tag_ids: [valid, deleted],
        notes: '保留备注',
        weather_override: { temperature_c: 0, condition: '雪' },
      },
      manual: true,
      temperature: '0',
      condition: '雪',
    }),
  )
  const user = userEvent.setup()
  const view = mount(<ConditionsPanel storageKey="tag-draft" />)
  await user.click(await screen.findByRole('button', { name: '移除已删除标签' }))
  await user.click(screen.getByRole('button', { name: '保存并核对条件' }))
  await screen.findByText('条件已核对，未生成搭配')
  expect(requests[0]).toMatchObject({
    custom_tag_ids: [valid],
    notes: '保留备注',
    weather_override: { temperature_c: 0, condition: '雪' },
  })
  view.unmount()
  mount(<ConditionsPanel storageKey="tag-draft" />)
  expect(await screen.findByLabelText('通勤')).toBeChecked()
  expect(screen.queryByRole('button', { name: '移除已删除标签' })).not.toBeInTheDocument()
})

it.each([false, true])(
  'restores and explicitly replays identical save after reload, committed=%s',
  async (committed) => {
    const bodies: string[] = []
    const stored = { ...prefs, fit: 'loose' as string | null, notes: '恢复原操作' }
    let attempts = 0
    server.use(
      http.patch('/api/v1/profile/preferences', async ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        bodies.push(await request.text())
        attempts++
        if (attempts === 1) return HttpResponse.error()
        return HttpResponse.json(envelope({ preferences: stored, version: 2 }))
      }),
    )
    const user = userEvent.setup()
    const view = mount(<PreferencesPanel />)
    await user.type(await screen.findByLabelText('偏好补充'), '恢复原操作')
    await user.selectOptions(screen.getByLabelText('版型'), 'loose')
    await user.click(screen.getByRole('button', { name: '保存偏好' }))
    await screen.findByRole('alert')
    view.unmount()
    // The server may have committed despite a lost response; GET can now have a newer version.
    server.use(
      http.get('/api/v1/profile/preferences', () =>
        HttpResponse.json(
          envelope({ preferences: committed ? stored : prefs, version: committed ? 2 : 1 }),
        ),
      ),
    )
    mount(<PreferencesPanel />)
    expect(await screen.findByLabelText('偏好补充')).toHaveValue('恢复原操作')
    expect(screen.getByLabelText('版型')).toHaveValue('loose')
    expect(attempts).toBe(1)
    await user.click(screen.getByRole('button', { name: '重发原保存操作' }))
    await screen.findByText('偏好已保存')
    expect(bodies[1]).toBe(bodies[0])
    expect(keys[1]).toBe(keys[0])
    expect(JSON.parse(bodies[1]).expected_version).toBe(1)
    expect(localStorage.getItem('wardrobe.save./profile/preferences')).toBeNull()
  },
)

it('explicitly discards a recovered save and loads the latest server preferences', async () => {
  localStorage.setItem(
    'wardrobe.save./profile/preferences',
    JSON.stringify({
      key: 'pending-original',
      signature: JSON.stringify({
        preferences: { ...prefs, notes: '放弃的草稿' },
        expected_version: 1,
      }),
    }),
  )
  const user = userEvent.setup()
  mount(<PreferencesPanel />)
  expect(await screen.findByLabelText('偏好补充')).toHaveValue('放弃的草稿')
  server.use(
    http.get('/api/v1/profile/preferences', () =>
      HttpResponse.json(envelope({ preferences: { ...prefs, notes: '最新偏好' }, version: 3 })),
    ),
  )
  await user.click(screen.getByRole('button', { name: '放弃草稿并重新载入偏好' }))
  await waitFor(() => expect(screen.getByLabelText('偏好补充')).toHaveValue('最新偏好'))
  expect(screen.queryByRole('button', { name: '重发原保存操作' })).not.toBeInTheDocument()
  expect(localStorage.getItem('wardrobe.save./profile/preferences')).toBeNull()
})

it('invalid manual weather reopens collapsed fields without submitting', async () => {
  const user = userEvent.setup()
  mount(<ConditionsPanel storageKey="invalid-manual-weather" />)
  await user.click(screen.getByText(/^更多条件/))
  await user.selectOptions(screen.getByLabelText('天气来源'), 'manual')
  await user.click(screen.getByText(/^更多条件/))
  expect(screen.getByLabelText('手动温度（℃）')).not.toBeVisible()
  await user.click(screen.getByRole('button', { name: '保存并核对条件' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('请输入 -90 至 60℃')
  expect(screen.getByLabelText('手动温度（℃）')).toBeVisible()
  expect(screen.getByLabelText('手动温度（℃）')).toHaveFocus()
  expect(requests).toHaveLength(0)
})
