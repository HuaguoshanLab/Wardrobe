import { createMemoryRouter, RouterProvider } from 'react-router'
import { useRef, createContext, useContext } from 'react'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { RowEditor } from './row-editor'
import { rowSchema } from './api'

const Content = createContext<React.ReactNode>(null)
const Slot = () => useContext(Content)
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
  const wrapper = ({ children }: { children: React.ReactNode }) => {
    const router = useRef(createMemoryRouter([{ path: '*', element: <Slot /> }]))
    return (
      <QueryClientProvider client={client}>
        <Content.Provider value={children}>
          <RouterProvider router={router.current} />
        </Content.Provider>
      </QueryClientProvider>
    )
  }
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

it('initial facts preserve unknowns, reject invalid money and save zero without losing base edits', async () => {
  saved = undefined
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RowEditor
          batchId={id}
          row={{ ...row, draft: { ...row.draft, category: 'top' } }}
          onClose={() => {}}
        />
      ),
    },
  ])
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  expect(screen.getByLabelText('衣物状况')).toHaveValue('unknown')
  expect(screen.getByLabelText('合身情况')).toHaveValue('unknown')
  await user.type(screen.getByLabelText('子类', { exact: true }), '短袖')
  await user.selectOptions(screen.getByLabelText('衣物状况'), 'good')
  await user.selectOptions(screen.getByLabelText('合身情况'), 'fits')
  await user.type(screen.getByLabelText('购入金额（元）'), '-1')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('金额需为非负数')
  expect(saved).toBeUndefined()
  await user.clear(screen.getByRole('textbox', { name: '购入金额（元）' }))
  await user.type(screen.getByRole('textbox', { name: '购入金额（元）' }), '0')
  await user.type(screen.getByLabelText('名称'), '人工短袖')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() =>
    expect(saved).toEqual({
      expected_version: 1,
      changes: {
        subtype_name: '短袖',
        condition: 'good',
        fit: 'fits',
        price: '0',
        name: '人工短袖',
      },
    }),
  )
})

it('changing category clears the old subtype and lets the user supply a new one', async () => {
  saved = undefined
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RowEditor
          batchId={id}
          row={{ ...row, draft: { ...row.draft, category: 'top', subtype_name: 'T恤' } }}
          onClose={() => {}}
        />
      ),
    },
  ])
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await screen.findByRole('option', { name: '鞋' })
  await user.selectOptions(screen.getByLabelText('品类'), 'shoes')
  expect(screen.getByLabelText('子类', { exact: true })).toHaveValue('')
  expect(screen.getByRole('status')).toHaveTextContent('原子类已清空')
  await user.type(screen.getByLabelText('子类', { exact: true }), '休闲鞋')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() =>
    expect(saved).toEqual({
      expected_version: 1,
      changes: { category: 'shoes', subtype_name: '休闲鞋' },
    }),
  )
})

it('can explicitly reset rejected Excel values already displayed as unknown', async () => {
  saved = undefined
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RowEditor
          batchId={id}
          row={{
            ...row,
            draft: { ...row.draft, category: 'top' },
            processing_errors: { price: '购入金额（元）字段不合法', fit: '合身情况字段不合法' },
          }}
          onClose={() => {}}
        />
      ),
    },
  ])
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await screen.findByRole('option', { name: '上装' })
  expect(screen.getByLabelText('购入金额（元）')).toHaveValue('')
  await user.click(screen.getByRole('button', { name: '重置购入金额（元）' }))
  await user.click(screen.getByRole('button', { name: '重置合身情况' }))
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await waitFor(() =>
    expect(saved).toEqual({ expected_version: 1, changes: { price: null, fit: 'unknown' } }),
  )
})
