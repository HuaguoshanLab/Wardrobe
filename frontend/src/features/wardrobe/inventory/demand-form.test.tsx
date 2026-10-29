import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { DemandForm } from './demand-form'
import { newDemand } from './api'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('估算中的参数改变后，晚到结果不能采用到新参数草稿', async () => {
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  server.use(
    http.post('/api/v1/inventory/estimate', async () => {
      calls++
      const first = calls === 1
      if (first) await waiting
      return HttpResponse.json({
        data: { lower: first ? 5 : 6, explanation: first ? '旧参数' : '新参数' },
        request_id: '00000000-0000-4000-8000-000000000001',
      })
    }),
  )
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <DemandForm
        initial={{ ...newDemand(), name: '日常上装' }}
        fields={{ category: { top: '上装' } }}
        subtypes={[]}
        tags={[]}
        busy={false}
        onDirty={() => {}}
        onApply={() => {}}
      />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByText('不确定件数？估算日常轮换'))
  await user.click(screen.getByRole('button', { name: '计算参考下限' }))
  await waitFor(() => expect(calls).toBe(1))
  await user.clear(screen.getByLabelText('备用件数'))
  await user.type(screen.getByLabelText('备用件数'), '2')
  release()
  await waitFor(() => expect(client.getMutationCache().getAll()[0].state.status).toBe('success'))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '采用此下限到草稿' })).not.toBeInTheDocument(),
  )
  expect(screen.getByLabelText('目标下限')).toHaveValue(null)
  await user.click(screen.getByRole('button', { name: '计算参考下限' }))
  await screen.findByText('参考下限 6 件')
  await user.click(screen.getByRole('button', { name: '采用此下限到草稿' }))
  expect(screen.getByLabelText('目标下限')).toHaveValue(6)
  expect(screen.getByLabelText('目标上限')).toHaveValue(null)
})

it('未采用的估算参数无效，不阻止保存手工目标', async () => {
  let applied = false
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DemandForm
        initial={{ ...newDemand(), name: '手工目标', lower: 2, upper: 4 }}
        fields={{ category: { top: '上装' } }}
        subtypes={[]}
        tags={[]}
        busy={false}
        onDirty={() => {}}
        onApply={() => {
          applied = true
        }}
      />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByText('不确定件数？估算日常轮换'))
  await user.clear(screen.getByLabelText('每件允许重复穿次数'))
  await user.type(screen.getByLabelText('每件允许重复穿次数'), '0')
  await user.click(screen.getByRole('button', { name: '计算参考下限' }))
  expect(screen.getByRole('alert')).toHaveTextContent('重复穿次数至少为 1')
  await user.click(screen.getByText('不确定件数？估算日常轮换'))
  await user.clear(screen.getByLabelText('目标下限'))
  await user.type(screen.getByLabelText('目标下限'), '5')
  await user.click(screen.getByRole('button', { name: '应用到本季草稿' }))
  await screen.findByText('同时填写上下限，且下限不能大于上限；也可同时留空。')
  expect(applied).toBe(false)
  await user.clear(screen.getByLabelText('目标下限'))
  await user.type(screen.getByLabelText('目标下限'), '2')
  await user.click(screen.getByRole('button', { name: '应用到本季草稿' }))
  await waitFor(() => expect(applied).toBe(true))
})
