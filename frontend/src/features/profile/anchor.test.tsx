import { afterAll, beforeAll, afterEach, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { AnchorNotice, useAnchor } from './anchor'
const server = setupServer(
  http.get('/api/v1/garments/:id', () =>
    HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: '衣服已删除' }, request_id: 'x' },
      { status: 404 },
    ),
  ),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())
function Harness({ id }: { id: string }) {
  const anchor = useAnchor(id)
  return (
    <>
      <AnchorNotice anchor={anchor} busy={false} onRemove={() => {}} />
      <button disabled={anchor.blocked}>生成</button>
    </>
  )
}
function mount(id: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Harness id={id} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
it('rejects an empty anchor instead of silently generating without it', () => {
  mount('')
  expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('指定单品无效')
})
it('keeps a deleted anchor visible and blocks generation until explicit removal', async () => {
  mount('00000000-0000-4000-8000-000000000001')
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '移除指定单品' })).toBeEnabled()
})
