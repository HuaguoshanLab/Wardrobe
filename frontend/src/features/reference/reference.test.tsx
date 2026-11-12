import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { ReferenceEditor } from './editor'
import { ReferencePage } from './page'
import type { Reference } from './api'

const id = '00000000-0000-4000-8000-000000000001'
const value: Reference = {
  id,
  version: 3,
  image_url: '/sample.png',
  analysis: { subject: 'single', clues: [], warnings: [] },
  clues: [{ category: 'top', color_codes: ['white'], style_codes: [], layer: 'unknown' }],
  confirmed: true,
  current_job_id: null,
  revision_ids: [],
  provider_mode: 'fake',
  created_at: '2026-11-12T00:00:00Z',
}
const envelope = (data: unknown) => ({ data, request_id: id })
let writes = 0
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({
        version: 1,
        fields: {
          category: { top: '上装' },
          color_codes: { white: '白色', black: '黑色' },
          style_codes: { minimal: '简约' },
        },
      }),
    ),
  ),
  http.get(`/api/v1/references/${id}`, () => HttpResponse.json(envelope(value))),
  http.post('*', () => {
    writes++
    return HttpResponse.json(envelope({}))
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  writes = 0
})
function mount(element: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter([{ path: '/collections/reference/:refId', element }], {
    initialEntries: [`/collections/reference/${id}`],
  })
  return render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}
it('restores confirmed clues without model calls, local edits block stale generation', async () => {
  const user = userEvent.setup()
  mount(<ReferencePage />)
  await screen.findByRole('button', { name: '生成近似搭配' })
  await user.click(await screen.findByRole('button', { name: '黑色' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '生成近似搭配' })).toBeDisabled())
  expect(writes).toBe(0)
  expect(
    JSON.parse(localStorage.getItem(`wardrobe.reference.draft:${id}`)!).clues[0].color_codes,
  ).toEqual(['white', 'black'])
})
it('restores local draft with original version and requires explicit conflict reconciliation', async () => {
  const user = userEvent.setup(),
    save = vi.fn()
  localStorage.setItem(
    `wardrobe.reference.draft:${id}`,
    JSON.stringify({ version: 2, clues: [{ ...value.clues[0], color_codes: ['black'] }] }),
  )
  mount(<ReferenceEditor value={value} busy={false} onSave={save} onDirty={() => {}} />)
  await screen.findByRole('button', { name: '黑色' })
  expect(screen.getByRole('button', { name: '确认这些线索' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '保留线索并采用最新版本' }))
  await user.click(screen.getByRole('button', { name: '确认这些线索' }))
  expect(save).toHaveBeenCalledWith([{ ...value.clues[0], color_codes: ['black'] }], 3)
  expect(writes).toBe(0)
})
it('removing all clues is explicit and saves an empty list rather than restoring AI guesses', async () => {
  const user = userEvent.setup(),
    save = vi.fn()
  mount(<ReferenceEditor value={value} busy={false} onSave={save} onDirty={() => {}} />)
  await screen.findByRole('button', { name: '白色' })
  await user.click(screen.getByRole('button', { name: '移除参考单品 1' }))
  await user.click(screen.getByRole('button', { name: '确认这些线索' }))
  expect(save).toHaveBeenCalledWith([], 3)
})
