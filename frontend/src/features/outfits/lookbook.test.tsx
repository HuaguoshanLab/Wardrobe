import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { useOutfits } from './use-outfits'
import { OutfitLookbook } from './lookbook'
import type { OutfitSession, Revision } from './api'

const sid = '00000000-0000-4000-8000-000000000001'
const ids = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
const revisions: Revision[] = ids.map((id, index) => ({
  id,
  session_id: sid,
  parent_revision_id: null,
  run_id: sid,
  reason: '已有单品组合',
  unmet_requirements: ['保暖程度未知'],
  weather_snapshot: { source: 'manual', temperature_c: 0, condition: '雪' },
  request_snapshot: {},
  provider_mode: 'fake',
  created_at: '2026-10-27T00:00:00Z',
  items: [
    {
      item_id: id,
      slot: 'top',
      source: 'wardrobe',
      garment_id: id,
      display_asset_id: id,
      image_url: '/example.png',
      attributes: { name: `上衣 ${index + 1}` },
      description: null,
    },
  ],
}))
let selected = ids[0]
let patches: unknown[] = []
const envelope = (data: unknown) => ({ data, request_id: sid })
const session = (): OutfitSession => ({
  id: sid,
  version: 1 + patches.length,
  requirements: {
    occasion_codes: [],
    season_codes: [],
    style_codes: null,
    custom_tag_ids: [],
    notes: null,
    weather_override: null,
  },
  selected_revision_id: selected,
  locked_garment_ids: [],
  current_job_id: null,
  latest_revision_ids: ids,
  revisions,
  messages: [],
  invalid_garment_ids: [],
  removed_lock_ids: [],
})
const server = setupServer(
  http.get('/api/v1/outfit-sessions/current', () => HttpResponse.json(envelope(session()))),
  http.patch('/api/v1/outfit-sessions/:id', async ({ request }) => {
    const body = (await request.json()) as { selected_revision_id: string }
    patches.push(body)
    selected = body.selected_revision_id
    return HttpResponse.json(envelope(session()))
  }),
  http.post('*', () => {
    throw new Error('Browsing must never generate')
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  selected = ids[0]
  patches = []
})
afterAll(() => server.close())
function Harness() {
  return <OutfitLookbook controller={useOutfits()} preparePath="/outfits/prepare" />
}
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
it('previewing is read-only; choosing persists and a reload restores the selected outfit', async () => {
  const user = userEvent.setup()
  const view = mount()
  await screen.findByAltText('上衣 1')
  await user.click(screen.getByRole('button', { name: '方案 02' }))
  expect(screen.getByAltText('上衣 2')).toBeVisible()
  expect(patches).toEqual([])
  expect(screen.queryByRole('link', { name: '调整这套' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '选用这套' }))
  await waitFor(() => expect(patches).toHaveLength(1))
  expect(patches[0]).toEqual({ expected_version: 1, selected_revision_id: ids[1] })
  expect(await screen.findByRole('button', { name: '调整这套' })).toBeEnabled()
  view.unmount()
  mount()
  expect(await screen.findByAltText('上衣 2')).toBeVisible()
  expect(patches).toHaveLength(1)
})
it('empty sessions provide a real preparation link and do not generate automatically', async () => {
  server.use(http.get('/api/v1/outfit-sessions/current', () => HttpResponse.json(envelope(null))))
  mount()
  expect(await screen.findByRole('link', { name: '准备搭配' })).toHaveAttribute(
    'href',
    '/outfits/prepare',
  )
  expect(patches).toEqual([])
})

it('opening a piece is read-only and replacing explicitly targets only that item', async () => {
  const user = userEvent.setup()
  const adjustments: unknown[] = []
  server.use(
    http.post('/api/v1/outfit-sessions/:id/adjust', async ({ request }) => {
      adjustments.push(await request.json())
      return HttpResponse.json(envelope({ job_id: sid, status: 'queued' }))
    }),
  )
  mount()
  await user.click(await screen.findByRole('button', { name: '查看上衣 1' }))
  expect(await screen.findByRole('dialog', { name: '上衣 1' })).toBeVisible()
  expect(adjustments).toEqual([])
  expect(patches).toEqual([])
  await user.click(screen.getByRole('button', { name: '只替换此项' }))
  await waitFor(() => expect(adjustments).toHaveLength(1))
  expect(adjustments[0]).toEqual({
    expected_version: 1,
    base_revision_id: ids[0],
    scope: 'replace_items',
    target_item_ids: [ids[0]],
    message: '',
  })
})

it('locked and preview items cannot be replaced from their sheets', async () => {
  const user = userEvent.setup()
  server.use(
    http.get('/api/v1/outfit-sessions/current', () =>
      HttpResponse.json(envelope({ ...session(), locked_garment_ids: [ids[0]] })),
    ),
  )
  mount()
  await user.click(await screen.findByRole('button', { name: '查看上衣 1' }))
  expect(screen.getByRole('button', { name: '只替换此项' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await user.click(screen.getByRole('button', { name: '方案 02' }))
  await user.click(screen.getByRole('button', { name: '查看上衣 2' }))
  expect(screen.getByRole('button', { name: '只替换此项' })).toBeDisabled()
  expect(patches).toEqual([])
})

it('adjustment opens on the lookbook without writing and preserves the chat draft across closing', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: '调整这套' }))
  expect(await screen.findByRole('dialog', { name: '调整这套' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: '锁定此单品' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: '重搭未锁定部分' })).toBeEnabled()
  await user.type(screen.getByLabelText('聊天调整要求'), '只换裤子')
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: '调整这套' }))
  expect(screen.getByLabelText('聊天调整要求')).toHaveValue('只换裤子')
  expect(patches).toEqual([])
})
