import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { ImportPage } from './upload'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it.each([
  ['fake', 'Fake 识别只模拟填入'],
  ['configured', '上传后将标准缩略图发送给千问'],
  ['unconfigured', '真实识别未配置'],
])('shows recognition mode %s without submitting photos', async (recognition, text) => {
  let uploads = 0
  server.use(
    http.get('/api/v1/capabilities', () =>
      HttpResponse.json({
        request_id: '00000000-0000-4000-8000-000000000002',
        data: {
          provider_mode: 'qwen',
          model: 'configured',
          recognition,
          weather: 'unconfigured',
          cutout: 'disabled',
          maintenance: false,
          data_epoch: '00000000-0000-4000-8000-000000000001',
        },
      }),
    ),
    http.post('/api/v1/imports/photos', () => {
      uploads += 1
      return HttpResponse.json({})
    }),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={createMemoryRouter([{ path: '*', element: <ImportPage /> }])} />
    </QueryClientProvider>,
  )
  expect(await screen.findByText(new RegExp(text))).toBeTruthy()
  expect(uploads).toBe(0)
})

it('blocks photos while capabilities are unknown and recovers after an explicit retry', async () => {
  let resolveRequest!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveRequest = resolve
  })
  let attempts = 0
  let uploads = 0
  server.use(
    http.get('/api/v1/capabilities', async () => {
      attempts += 1
      if (attempts === 1) {
        await pending
        return HttpResponse.json(
          { error: { code: 'UNAVAILABLE', message: '连接失败' } },
          { status: 503 },
        )
      }
      return HttpResponse.json({
        request_id: '00000000-0000-4000-8000-000000000002',
        data: {
          provider_mode: 'qwen',
          model: 'configured',
          recognition: 'configured',
          weather: 'unconfigured',
          cutout: 'disabled',
          maintenance: false,
          data_epoch: '00000000-0000-4000-8000-000000000001',
        },
      })
    }),
    http.post('/api/v1/imports/photos', () => {
      uploads += 1
      return HttpResponse.json({})
    }),
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={createMemoryRouter([{ path: '*', element: <ImportPage /> }])} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('上传照片'), {
    target: { files: [new File(['photo'], 'shirt.png', { type: 'image/png' })] },
  })
  const submit = screen.getByRole('button', { name: /上传并/ }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  expect(screen.queryByText(/真实识别未配置/)).toBeNull()
  resolveRequest()
  await screen.findByText(/识别配置读取失败/)
  fireEvent.click(submit)
  expect(submit.disabled).toBe(true)
  expect(uploads).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: '重试读取识别配置' }))
  await screen.findByText(/上传后将标准缩略图发送给千问/)
  await waitFor(() => expect(submit.disabled).toBe(false))
  expect(uploads).toBe(0)
})
