import { expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { revisionSchema } from './api'
import { RotationEvidence } from './rotation-evidence'

const evidence = {
  mode: 'less_worn',
  as_of: '2026-10-30',
  start: '2026-10-01',
  record_count: 8,
  record_days: 5,
  full_repeat: false,
  body_repeat: false,
  message: '完整说明：仅比较替换项，其余单品完整保留。',
  items: [{ garment_id: 'shirt', name: '这是一件完整的长名称上衣', wear_days: 0 }],
}
function revision(rotation: unknown = evidence, id = '00000000-0000-4000-8000-000000000001') {
  return revisionSchema.parse({
    id,
    source: 'generated',
    session_id: null,
    run_id: null,
    parent_revision_id: null,
    items: [],
    reason: '',
    unmet_requirements: [],
    weather_snapshot: {},
    request_snapshot: {
      rotation,
      locked_garment_ids: ['shirt'],
      intent: { scope: 'replace_items' },
    },
    provider_mode: 'fake',
    created_at: '2026-10-30T00:00:00Z',
  })
}
function view(rotation: unknown = evidence) {
  return render(
    <MemoryRouter>
      <RotationEvidence revision={revision(rotation)} />
    </MemoryRouter>,
  )
}
it('legacy and malformed evidence do not invent rotation claims', () => {
  const component = view(null)
  expect(screen.queryByRole('region', { name: '轮换依据' })).not.toBeInTheDocument()
  component.rerender(
    <MemoryRouter>
      <RotationEvidence revision={revision({ ...evidence, as_of: 'invalid' })} />
    </MemoryRouter>,
  )
  expect(screen.queryByRole('region', { name: '轮换依据' })).not.toBeInTheDocument()
})
it('no records has priority over repeat flags and offers a read-only calendar route', () => {
  view({ ...evidence, mode: 'avoid_recent', record_count: 0, record_days: 0, full_repeat: true })
  expect(screen.getByRole('heading', { name: '暂无近期穿着记录' })).toBeVisible()
  expect(screen.getByText('本次轮换依据不足，无记录不代表从未穿过。')).toBeVisible()
  expect(screen.getByRole('link', { name: '查看穿着记录' })).toHaveAttribute(
    'href',
    '/collections?view=calendar',
  )
  expect(screen.queryByText('近期穿过这套组合')).not.toBeInTheDocument()
})
it('body repeats and replacement limits remain visible with full explanation collapsed', async () => {
  const user = userEvent.setup()
  view({ ...evidence, mode: 'avoid_recent', body_repeat: true, items: [] })
  expect(screen.getByRole('heading', { name: '主体组合近期穿过' })).toBeVisible()
  expect(screen.getByText('仅比较替换项，其余单品保持')).toBeVisible()
  expect(screen.getByText(evidence.message)).not.toBeVisible()
  await user.click(screen.getByText('查看轮换依据'))
  expect(screen.getByText(evidence.message)).toBeVisible()
})
it('full item names and zero-day meaning survive disclosure; switching revisions resets it', async () => {
  const user = userEvent.setup()
  const component = view()
  await user.click(screen.getByText('查看轮换依据 · 1 件单品'))
  expect(screen.getByText(evidence.items[0].name)).toBeVisible()
  expect(screen.getByText('期间无记录')).toBeVisible()
  component.rerender(
    <MemoryRouter>
      <RotationEvidence revision={revision(evidence, '00000000-0000-4000-8000-000000000002')} />
    </MemoryRouter>,
  )
  expect(screen.getByText(evidence.items[0].name)).not.toBeVisible()
  expect(evidence.items[0].wear_days).toBe(0)
})
it('missing repeat flags never imply the combination is new', () => {
  const { full_repeat: _full, body_repeat: _body, ...legacy } = evidence
  view({ ...legacy, mode: 'avoid_recent' })
  expect(screen.getByRole('heading', { name: '按近期记录比较组合' })).toBeVisible()
  expect(screen.queryByText('近期记录中未见相同组合')).not.toBeInTheDocument()
})
