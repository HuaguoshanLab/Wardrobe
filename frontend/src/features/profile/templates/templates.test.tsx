import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { ConditionsPanel } from '../conditions'
import { type Requirements } from '../api'
import { pendingOperation } from './api'
const id = '00000000-0000-4000-8000-000000000001'
const envelope = (data: unknown) => ({ data, request_id: id })
const fields = {
  occasion_codes: ['work'],
  style_codes: null,
  custom_tag_ids: [],
  notes: null,
  rotation_mode: 'less_worn',
}
const template = {
  id,
  name: '通勤',
  conditions: fields,
  version: 1,
  created_at: '2026-11-04',
  updated_at: '2026-11-04',
  issues: [],
}
const server = setupServer(
  http.get('/api/v1/taxonomies', () =>
    HttpResponse.json(
      envelope({
        version: 1,
        fields: {
          occasion_codes: { work: '通勤' },
          style_codes: { casual: '休闲' },
          seasons: { winter: '冬' },
        },
      }),
    ),
  ),
  http.get('/api/v1/tags', () => HttpResponse.json(envelope([]))),
  http.get('/api/v1/condition-templates', () => HttpResponse.json(envelope([template]))),
  http.get('/api/v1/condition-templates/:id', () => HttpResponse.json(envelope(template))),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())
function mount(onGenerate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter([
          {
            path: '*',
            element: (
              <ConditionsPanel storageKey="wardrobe.test.templates" onGenerate={onGenerate} />
            ),
          },
        ])}
      />
    </QueryClientProvider>,
  )
  return { ...result, onGenerate }
}
async function open() {
  const b = screen.getByRole('button', { name: '条件模板' })
  await waitFor(() => expect(b).toBeEnabled())
  await userEvent.click(b)
}
it('selection explicitly replaces fields but retains manual zero weather and season without generation', async () => {
  const requirements: Requirements = {
    ...fields,
    rotation_mode: 'normal',
    occasion_codes: [],
    style_codes: [],
    notes: '未保存旧说明',
    season_codes: ['winter'],
    weather_override: { temperature_c: 0, condition: '雪' },
  }
  localStorage.setItem(
    'wardrobe.test.templates',
    JSON.stringify({ requirements, manual: true, temperature: '0', condition: '雪' }),
  )
  const view = mount()
  await open()
  await userEvent.click(await screen.findByRole('button', { name: '通勤 查看与选用' }))
  expect(screen.getByLabelText('本次补充要求')).toHaveValue('未保存旧说明')
  await userEvent.click(screen.getByRole('button', { name: '确认替换当前条件' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('本次补充要求')).toHaveValue('')
  expect(screen.getByLabelText('手动温度（℃）')).toHaveValue(0)
  const draft = JSON.parse(localStorage.getItem('wardrobe.test.templates')!)
  expect(draft.requirements.style_codes).toBeNull()
  expect(draft.requirements.season_codes).toEqual(['winter'])
  expect(view.onGenerate).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: '生成搭配' }))
  expect(view.onGenerate).toHaveBeenCalledWith(
    expect.objectContaining({
      weather_override: { temperature_c: 0, condition: '雪' },
      rotation_mode: 'less_worn',
      notes: null,
    }),
  )
})
it('ambiguous create survives refresh and retries original body/key only on explicit click', async () => {
  let fail = true
  const sent: { key: string | null; body: string }[] = []
  server.use(
    http.post('/api/v1/condition-templates', async ({ request }) => {
      sent.push({ key: request.headers.get('Idempotency-Key'), body: await request.text() })
      return fail ? HttpResponse.error() : HttpResponse.json(envelope(template), { status: 201 })
    }),
  )
  const first = mount()
  await open()
  await userEvent.click(screen.getByRole('button', { name: '将当前条件另存为模板' }))
  await userEvent.type(screen.getByLabelText('模板名称'), '我的通勤')
  await userEvent.click(screen.getByRole('button', { name: '保存模板' }))
  await screen.findByRole('button', { name: '重发原模板操作' })
  expect(pendingOperation()).not.toBeNull()
  first.unmount()
  fail = false
  mount()
  await open()
  expect(sent).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: '重发原模板操作' }))
  await screen.findByText('模板已保存。')
  expect(sent[1]).toEqual(sent[0])
  expect(pendingOperation()).toBeNull()
})
it('invalid references block selection and require explicit repair in the editor', async () => {
  const stale = {
    ...template,
    conditions: { ...fields, custom_tag_ids: [id] },
    issues: ['标签已删除'],
  }
  server.use(http.get('/api/v1/condition-templates/:id', () => HttpResponse.json(envelope(stale))))
  mount()
  await open()
  await userEvent.click(await screen.findByRole('button', { name: '通勤 查看与选用' }))
  expect(screen.getByRole('button', { name: '确认替换当前条件' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '编辑模板' }))
  expect(screen.getByRole('button', { name: '保存模板' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '移除失效条件' }))
  expect(screen.getByRole('button', { name: '保存模板' })).toBeEnabled()
})

it('an existing editor draft cannot be overwritten by editing another template', async () => {
  localStorage.setItem(
    'wardrobe.template.editor',
    JSON.stringify({
      id: null,
      version: null,
      name: '未保存的工作',
      fields,
      unsupported: false,
    }),
  )
  mount()
  await open()
  expect(screen.getByRole('button', { name: '将当前条件另存为模板' })).toBeDisabled()
  await userEvent.click(await screen.findByRole('button', { name: '通勤 查看与选用' }))
  expect(screen.getByRole('button', { name: '编辑模板' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '返回模板列表' }))
  await userEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }))
  expect(screen.getByLabelText('模板名称')).toHaveValue('未保存的工作')
})

it('cancelling deletion sends nothing and deleting another template preserves the editing draft', async () => {
  const draft = { id: null, version: null, name: '需要保留', fields, unsupported: false }
  localStorage.setItem('wardrobe.template.editor', JSON.stringify(draft))
  let deletes = 0
  server.use(
    http.delete('/api/v1/condition-templates/:id', () => {
      deletes++
      return HttpResponse.json(envelope({ id, version: 2, deleted: true }))
    }),
  )
  mount()
  await open()
  await userEvent.click(await screen.findByRole('button', { name: '通勤 查看与选用' }))
  await userEvent.click(screen.getByRole('button', { name: '删除模板' }))
  await userEvent.click(screen.getByRole('button', { name: '取消删除' }))
  expect(deletes).toBe(0)
  expect(screen.getByRole('button', { name: '确认替换当前条件' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: '删除模板' }))
  await userEvent.click(screen.getByRole('button', { name: '确认删除模板' }))
  await screen.findByText('模板已删除，已有搭配和草稿保持。')
  expect(deletes).toBe(1)
  expect(JSON.parse(localStorage.getItem('wardrobe.template.editor')!)).toEqual(draft)
  await userEvent.click(screen.getByRole('button', { name: '继续编辑草稿' }))
  expect(screen.getByLabelText('模板名称')).toHaveValue('需要保留')
})
