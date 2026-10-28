import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import userEvent from '@testing-library/user-event'
import { WeatherPanel } from './weather'
import type { City } from './api'

const city: City = {
  id: 'hangzhou',
  name: '杭州',
  adm1: '浙江省',
  adm2: '杭州',
  source: 'qweather',
  latitude: 30.27,
  longitude: 120.15,
}
const server = setupServer(
  http.get('/api/v1/weather', ({ request }) => {
    if (new URL(request.url).searchParams.get('city_id') !== 'hangzhou') {
      return HttpResponse.json(
        { error: { code: 'WEATHER_UNAVAILABLE', message: '没有可用天气，请手动填写' } },
        { status: 503 },
      )
    }
    return HttpResponse.json({
      request_id: '00000000-0000-4000-8000-000000000001',
      data: {
        city,
        errors: ['WEATHER_UNAVAILABLE'],
        daily: null,
        current: {
          source: 'qweather',
          kind: 'current',
          city,
          observed_at: null,
          fetched_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-01T00:15:00Z',
          valid_for: '2026-01-01',
          temperature_c: 0,
          feels_like_c: null,
          minimum_c: null,
          maximum_c: null,
          condition: '雪',
          precipitation_mm: null,
          stale: true,
          attribution: ['QWeather'],
        },
      },
    })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('expired weather is reference only and never shown for another city', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const renderCity = (value: City) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WeatherPanel city={value} />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(renderCity(city))
  expect(await screen.findByText('已过期，仅供参考')).toBeInTheDocument()
  expect(screen.getByText('0℃')).toBeInTheDocument()
  expect(screen.getByText(/获取时间不等于观测时间/)).not.toBeVisible()
  await userEvent.click(screen.getByText('来源与更新时间'))
  expect(screen.getByText(/获取时间不等于观测时间/)).toBeVisible()
  view.rerender(renderCity({ ...city, id: 'nanjing', name: '南京', adm1: '江苏省' }))
  expect(await screen.findByText('没有可用天气，请手动填写')).toBeInTheDocument()
  expect(screen.queryByText('0℃')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '南京' })).toBeInTheDocument()
})
