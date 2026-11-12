import { beforeAll, afterAll, afterEach, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
import {
  consecutive,
  draftSchema,
  forgetOperation,
  operation,
  pendingOperation,
  sendOperation,
} from './api'

afterEach(() => localStorage.clear())
it('keeps original body and key after a lost response, never sends on restore', async () => {
  const requests: string[] = []
  server.use(
    http.post('/api/v1/travel-plans/p/generate', async ({ request }) => {
      requests.push(request.headers.get('Idempotency-Key')! + (await request.text()))
      if (requests.length === 1) return HttpResponse.error()
      return HttpResponse.json({
        data: { job_id: 'a4c839f1-12a8-4ea4-9c80-32b080611af7', status: 'queued' },
        request_id: 'a4c839f1-12a8-4ea4-9c80-32b080611af7',
      })
    }),
  )
  const op = operation('/travel-plans/p/generate', { expected_version: 2 })
  await expect(sendOperation(op)).rejects.toThrow()
  expect(pendingOperation()).toEqual(op)
  expect(requests).toHaveLength(1)
  await sendOperation(pendingOperation()!)
  expect(requests[0]).toBe(requests[1])
  expect(pendingOperation()).toBeNull()
})
it('clears a definite rejected operation but retains it after server failure', async () => {
  const op = operation('/travel-plans', { name: 'x' })
  server.use(
    http.post('/api/v1/travel-plans', () =>
      HttpResponse.json(
        { error: { message: 'conflict', code: 'VERSION_CONFLICT' } },
        { status: 409 },
      ),
    ),
  )
  await expect(sendOperation(op)).rejects.toThrow()
  expect(pendingOperation()).toBeNull()
  server.use(
    http.post('/api/v1/travel-plans', () =>
      HttpResponse.json({ error: { message: 'offline', code: 'UNAVAILABLE' } }, { status: 503 }),
    ),
  )
  await expect(sendOperation(op)).rejects.toThrow()
  expect(pendingOperation()).toEqual(op)
  forgetOperation()
  expect(pendingOperation()).toBeNull()
})
it('builds continuous dates across month and year boundaries', () => {
  expect(consecutive('2026-12-30', 4)).toEqual([
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
  ])
  expect(consecutive('2028-02-28', 3)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  expect(consecutive('', 3)).toEqual([])
})

it('retains incomplete weather and an empty name in editor drafts', () => {
  const value = {
    name: '',
    city: {
      source: 'manual',
      name: '',
      adm1: '广东省',
      adm2: '',
      id: null,
      latitude: null,
      longitude: null,
    },
    days: [{ date: '2026-11-11', occasion: 'daily', weather: { temperature_c: 0, condition: '' } }],
    required_garment_ids: [],
    target_count: 8,
    allow_repeat: true,
    notes: '待补充',
  }
  expect(draftSchema.parse(value)).toEqual(value)
})
