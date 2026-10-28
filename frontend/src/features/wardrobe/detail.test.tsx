import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { GarmentPage } from './detail'
import { Tags } from './tags'

const id = '00000000-0000-4000-8000-000000000001'
const envelope = (data: unknown) => ({ data, request_id: id })
const garment = {
  id,
  image_asset_id: id,
  version: 1,
  created_at: '',
  image_url: '/image.png',
  has_cutout: true,
  is_demo: false,
  category: 'tops',
  name: '白衬衫',
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
}
let patches: { expected_version: number; changes: Record<string, unknown> }[] = []
const server = setupServer(
  http.get('/api/v1/garments/:id', () => HttpResponse.json(envelope(garment))),
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({
        version: 1,
        fields: {
          category: { tops: '上衣' },
          color_codes: { white: '白色', black: '黑色' },
          seasons: { spring: '春季' },
        },
      }),
    ),
  ),
  http.get('/api/v1/tags', () => HttpResponse.json(envelope([]))),
  http.patch('/api/v1/garments/:id', async ({ request }) => {
    const body = (await request.json()) as (typeof patches)[number]
    patches.push(body)
    return HttpResponse.json(
      envelope({ ...garment, ...body.changes, version: body.expected_version + 1 }),
    )
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  patches = []
})
afterAll(() => server.close())
function mount(element = <GarmentPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      { path: '/wardrobe/:id', element },
      { path: '/wardrobe', element: <p>衣橱列表</p> },
    ],
    { initialEntries: [`/wardrobe/${id}`] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}
it('opens read-only, previews without writes and saves only changed attributes', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: '去背景' }))
  expect(patches).toHaveLength(0)
  expect(screen.getByRole('button', { name: '设为默认展示图' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '编辑单品信息' }))
  expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
  await user.click(await screen.findByRole('button', { name: '白色' }))
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await screen.findByRole('button', { name: '编辑单品信息' })
  expect(patches).toEqual([{ expected_version: 1, changes: { color_codes: ['white'] } }])
})
it('blocks navigation with unsaved edits and keeps the draft until explicit discard', async () => {
  const user = userEvent.setup()
  const router = mount()
  await user.click(await screen.findByRole('button', { name: '编辑单品信息' }))
  await user.clear(screen.getByLabelText('名称'))
  await user.type(screen.getByLabelText('名称'), '新名字')
  await user.click(screen.getByRole('link', { name: '返回衣橱' }))
  await user.click(await screen.findByRole('button', { name: '继续编辑' }))
  expect(screen.getByLabelText('名称')).toHaveValue('新名字')
  await user.click(screen.getByRole('button', { name: '取消编辑' }))
  await user.click(await screen.findByRole('button', { name: '放弃修改' }))
  expect(patches).toHaveLength(0)
  expect(router.state.location.pathname).toBe(`/wardrobe/${id}`)
  await screen.findByRole('heading', { name: '白衬衫' })
})
it('retains draft on conflict and explicitly rebases it on the latest version', async () => {
  let currentVersion = 1
  server.use(
    http.get('/api/v1/garments/:id', () =>
      HttpResponse.json(
        envelope({
          ...garment,
          version: currentVersion,
          seasons: currentVersion > 1 ? ['spring'] : [],
        }),
      ),
    ),
    http.patch('/api/v1/garments/:id', async ({ request }) => {
      const body = (await request.json()) as (typeof patches)[number]
      patches.push(body)
      if (body.expected_version === 1) {
        currentVersion = 2
        return HttpResponse.json(
          { error: { code: 'VERSION_CONFLICT', message: '衣服已更新' } },
          { status: 409 },
        )
      }
      return HttpResponse.json(
        envelope({ ...garment, ...body.changes, version: 3, seasons: ['spring'] }),
      )
    }),
  )
  const user = userEvent.setup()
  mount()
  await user.click(await screen.findByRole('button', { name: '编辑单品信息' }))
  await user.clear(screen.getByLabelText('名称'))
  await user.type(screen.getByLabelText('名称'), '保留我的名称')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await user.click(await screen.findByRole('button', { name: '保留修改并读取最新版本' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '春季' })).toHaveAttribute('aria-pressed', 'true'),
  )
  expect(screen.getByLabelText('名称')).toHaveValue('保留我的名称')
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await screen.findByRole('button', { name: '编辑单品信息' })
  expect(patches[1]).toEqual({ expected_version: 2, changes: { name: '保留我的名称' } })
})
it('submits a new tag with the actual add button', async () => {
  let posted = ''
  server.use(
    http.post('/api/v1/tags', async ({ request }) => {
      posted = ((await request.json()) as { name: string }).name
      return HttpResponse.json(envelope({ id, name: posted, version: 1 }))
    }),
  )
  const user = userEvent.setup()
  mount(<Tags />)
  await user.click(screen.getByRole('button', { name: '管理标签' }))
  await user.type(await screen.findByLabelText('新标签'), '旅行常穿')
  await user.click(screen.getByRole('button', { name: '添加标签' }))
  await waitFor(() => expect(posted).toBe('旅行常穿'))
  expect(screen.getByLabelText('新标签')).toHaveValue('')
})

it('renames and deletes tags through explicit application confirmations', async () => {
  let stored = [{ id, name: '旅行', version: 1 }]
  let removedVersion: string | null = null
  server.use(
    http.get('/api/v1/tags', () => HttpResponse.json(envelope(stored))),
    http.patch('/api/v1/tags/:id', async ({ request }) => {
      const body = (await request.json()) as { name: string; expected_version: number }
      expect(body.expected_version).toBe(1)
      stored = [{ id, name: body.name, version: 2 }]
      return HttpResponse.json(envelope(stored[0]))
    }),
    http.delete('/api/v1/tags/:id', ({ request }) => {
      removedVersion = request.headers.get('If-Match')
      stored = []
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const user = userEvent.setup()
  mount(<Tags />)
  await user.click(screen.getByRole('button', { name: '管理标签' }))
  await user.click(await screen.findByRole('button', { name: '重命名旅行' }))
  await user.clear(screen.getByLabelText('标签名称'))
  await user.type(screen.getByLabelText('标签名称'), '出游')
  await user.click(screen.getByRole('button', { name: '保存名称' }))
  await user.click(await screen.findByRole('button', { name: '删除标签出游' }))
  expect(removedVersion).toBeNull()
  expect(screen.getByText(/衣服本身和历史穿搭不会被删除/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '确认删除标签' }))
  await screen.findByText('还没有标签，添加第一个吧。')
  expect(removedVersion).toBe('2')
})
