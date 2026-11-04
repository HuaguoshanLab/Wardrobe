import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { LocationInput } from './input'
import { LocationChoices } from './choices'
import { WardrobePage } from '../page'
import { useState } from 'react'

const envelope = (data: unknown) => ({ data, request_id: '00000000-0000-4000-8000-000000000001' })
let reads: URLSearchParams[] = []
const server = setupServer(
  http.get('/api/v1/wardrobe/locations', ({ request }) => {
    const p = new URL(request.url).searchParams
    reads.push(p)
    return HttpResponse.json(
      envelope({
        items: p.get('location_q')
          ? [{ location: '柜%_一层', count: 2 }]
          : p.get('cursor')
            ? [{ location: '箱子', count: 3 }]
            : [{ location: '衣柜', count: 25 }],
        next_cursor: p.get('location_q') || p.get('cursor') ? null : '衣柜',
        total_garments: 30,
        unassigned_count: 2,
        matching_locations: p.get('location_q') ? 1 : 2,
      }),
    )
  }),
  http.get('/api/v1/garments', () => HttpResponse.json(envelope({ items: [], next_cursor: null }))),
  http.get('/api/v1/tags', () => HttpResponse.json(envelope([]))),
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({ version: 1, fields: { category: { top: '上装' }, seasons: { summer: '夏' } } }),
    ),
  ),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  reads = []
  sessionStorage.clear()
})
afterAll(() => server.close())
function mount(children: React.ReactNode, path = '/wardrobe') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
}
function Url() {
  return <output data-testid="url">{useLocation().search}</output>
}

it('location totals and pagination use the full backend scope, selection returns the exact name', async () => {
  const user = userEvent.setup(),
    select = vi.fn()
  mount(
    <LocationChoices
      filters={{
        category: 'top',
        season: 'summer',
        availability: 'unavailable',
        location: '旧',
        location_mode: 'named',
      }}
      onSelect={select}
    />,
  )
  await screen.findByRole('button', { name: '衣柜 25 件' })
  expect(screen.getByRole('button', { name: '全部位置 30 件' })).toBeVisible()
  expect(reads[0].get('category')).toBe('top')
  expect(reads[0].get('season')).toBe('summer')
  expect(reads[0].get('availability')).toBe('unavailable')
  expect(reads[0].has('location')).toBe(false)
  await user.click(screen.getByRole('button', { name: '加载更多位置' }))
  await user.click(await screen.findByRole('button', { name: '箱子 3 件' }))
  expect(select).toHaveBeenLastCalledWith({ mode: 'named', location: '箱子' })
  await user.type(screen.getByLabelText('搜索已有位置'), '%_')
  await user.click(await screen.findByRole('button', { name: '柜%_一层 2 件' }))
  expect(select).toHaveBeenLastCalledWith({ mode: 'named', location: '柜%_一层' })
  expect(reads.at(-1)?.get('location_q')).toBe('%_')
  expect(reads.at(-1)?.has('cursor')).toBe(false)
})

it('choosing an existing location changes only the draft, keeps manual input and returns focus', async () => {
  function Editor() {
    const [value, set] = useState('我的新位置')
    return <LocationInput label="收纳位置" value={value} onChange={set} />
  }
  const user = userEvent.setup()
  mount(<Editor />)
  expect(reads).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '选择已有位置' }))
  await user.click(await screen.findByRole('button', { name: '衣柜 25 件' }))
  expect(screen.getByLabelText('收纳位置')).toHaveValue('衣柜')
  expect(screen.getByLabelText('收纳位置')).toHaveFocus()
  await user.clear(screen.getByLabelText('收纳位置'))
  await user.type(screen.getByLabelText('收纳位置'), '新写的位置')
  expect(screen.getByLabelText('收纳位置')).toHaveValue('新写的位置')
})

it('a location query error can retry without erasing the location draft', async () => {
  let fail = true
  server.use(
    http.get('/api/v1/wardrobe/locations', () =>
      fail
        ? HttpResponse.error()
        : HttpResponse.json(
            envelope({
              items: [],
              total_garments: 0,
              unassigned_count: 0,
              matching_locations: 0,
              next_cursor: null,
            }),
          ),
    ),
  )
  const user = userEvent.setup(),
    change = vi.fn()
  mount(<LocationInput label="收纳位置" value="已有输入" onChange={change} />)
  await user.click(screen.getByRole('button', { name: '选择已有位置' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('收纳位置')).toHaveValue('已有输入')
  fail = false
  await user.click(screen.getByRole('button', { name: '重新读取位置' }))
  await screen.findByText('还没有已填写的位置，可直接输入新位置。')
  expect(change).not.toHaveBeenCalled()
})

it('wardrobe location selection keeps other filters and removing it clears both location parameters', async () => {
  const user = userEvent.setup()
  mount(
    <>
      <WardrobePage />
      <Url />
    </>,
    '/wardrobe?category=top&season=summer',
  )
  await user.click(screen.getByRole('button', { name: '按收纳位置找衣服' }))
  await user.click(await screen.findByRole('button', { name: '衣柜 25 件' }))
  await waitFor(() =>
    expect(screen.getByTestId('url').textContent).toContain('location_mode=named'),
  )
  const parsed = new URLSearchParams(screen.getByTestId('url').textContent!)
  expect(parsed.get('category')).toBe('top')
  expect(parsed.get('season')).toBe('summer')
  expect(parsed.get('location')).toBe('衣柜')
  await user.click(screen.getByRole('button', { name: '移除筛选：位置：衣柜' }))
  expect(screen.getByTestId('url')).toHaveTextContent('?category=top&season=summer')
  await user.click(screen.getByRole('button', { name: '按收纳位置找衣服' }))
  const dialog = screen.getByRole('dialog')
  await user.click(await within(dialog).findByRole('button', { name: '未填写位置 2 件' }))
  expect(screen.getByTestId('url')).toHaveTextContent('location_mode=unassigned')
  expect(new URLSearchParams(screen.getByTestId('url').textContent!).has('location')).toBe(false)
})
