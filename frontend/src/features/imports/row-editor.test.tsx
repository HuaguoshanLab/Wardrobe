import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { RowEditor } from './row-editor'
import { rowSchema } from './api'

const id = '00000000-0000-4000-8000-000000000001'
const row = rowSchema.parse({
  id,
  row_number: 1,
  filename: 'a.png',
  image_asset_id: id,
  image_url: '/image',
  has_cutout: false,
  draft: {
    category: null,
    name: null,
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
  },
  version: 1,
  touched_fields: [],
  validation_errors: [],
  processing_errors: {},
  row_status: 'invalid',
  conversion_status: 'succeeded',
  analysis_status: 'running',
  cutout_status: 'queued',
  analysis_source: null,
  analysis_notes: [],
  confirmed_garment_id: null,
})
const envelope = (data: unknown) => ({ data, request_id: id })
let saved: unknown
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({
        version: 1,
        fields: {
          category: { top: '上装', shoes: '鞋' },
          availability: { available: '可穿', unavailable: '暂不可用' },
        },
      }),
    ),
  ),
  http.get('/api/v1/tags', () => HttpResponse.json(envelope([]))),
  http.patch('/api/v1/imports/:batch/rows/:row', async ({ request }) => {
    saved = await request.json()
    return HttpResponse.json(envelope(row))
  }),
)
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  Element.prototype.scrollIntoView = vi.fn()
})
afterAll(() => server.close())
it('background polling preserves an unsaved draft and submits its opening version', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const view = render(<RowEditor batchId={id} row={row} onClose={() => {}} />, { wrapper })
  const user = userEvent.setup()
  await screen.findByRole('option', { name: '鞋' })
  await user.selectOptions(screen.getByLabelText('品类'), 'shoes')
  await user.type(screen.getByLabelText('名称'), '我的鞋')
  view.rerender(
    <RowEditor
      batchId={id}
      row={{ ...row, version: 5, draft: { ...row.draft, category: 'top', name: '后台识别' } }}
      onClose={() => {}}
    />,
  )
  expect(screen.getByLabelText('名称')).toHaveValue('我的鞋')
  expect(screen.getByLabelText('品类')).toHaveValue('shoes')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() =>
    expect(saved).toEqual({ expected_version: 1, changes: { category: 'shoes', name: '我的鞋' } }),
  )
})
