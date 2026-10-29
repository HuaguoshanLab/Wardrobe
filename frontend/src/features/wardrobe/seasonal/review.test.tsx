import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { garmentSchema } from '../api'
import { Review } from './review'
import type { Seasonal } from './api'
import type { OperationController } from '../../../lib/use-operation'

const id = '00000000-0000-4000-8000-000000000001'
const garment = garmentSchema.parse({
  id,
  image_asset_id: id,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  image_url: '/image.png',
  has_cutout: false,
  is_demo: false,
  category: 'top',
  name: '衬衫',
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
})
const inventory: Seasonal['inventory'] = {
  plan: { season: 'summer', version: 0, city: '', period: '', notes: '', rows: [] },
  stats_at: '2026-01-01T00:00:00Z',
  config_versions: {},
  total_owned: 1,
  counts: [],
  garments: [],
}
const items: Seasonal['items'] = [
  {
    garment_id: id,
    original: garment,
    current: garment,
    reviewed_version: null,
    stale: false,
    todo: '',
  },
]
const session: Seasonal = {
  id,
  version: 1,
  season: 'summer',
  scope: 'all',
  categories: [],
  stage: 'review',
  created_at: '2026-01-01T00:00:00Z',
  completed_at: null,
  items,
  inventory,
  actions: [],
  target_token: 't',
  targets_confirmed: false,
  preview_token: 'p',
  summary: null,
  preview: {
    stats_at: inventory.stats_at,
    rules_token: 't',
    inventory,
    items,
    actions: [],
    reviewed: 0,
    total: 1,
    unresolved: [],
    outside_scope: 0,
  },
}
function operation(): OperationController {
  return {
    pending: null,
    notice: '',
    error: null,
    busy: false,
    sending: false,
    send: vi.fn(),
    resend: vi.fn(),
    discard: vi.fn(),
  }
}
it('跨页重取不会悄悄用新版本提交旧核对，保留待办草稿', async () => {
  const op = operation()
  const onDirty = vi.fn()
  const user = userEvent.setup()
  const ui = (s: Seasonal) => (
    <MemoryRouter>
      <Review session={s} operation={op} onDirty={onDirty} />
    </MemoryRouter>
  )
  const view = render(ui(session))
  await user.click(screen.getByRole('button', { name: '核对这件' }))
  await user.click(screen.getByLabelText('已查看当前资料与实际状况'))
  await user.type(screen.getByLabelText('留给自己的待办'), '试穿再决定')
  view.rerender(ui({ ...session, items: [{ ...items[0], current: { ...garment, version: 2 } }] }))
  expect(screen.getByLabelText('留给自己的待办')).toHaveValue('试穿再决定')
  await user.click(screen.getByRole('button', { name: '保存这件核对' }))
  expect(op.send).toHaveBeenCalledWith(
    `/seasonal-sessions/${id}/progress`,
    'POST',
    expect.objectContaining({
      items: [expect.objectContaining({ garment_version: 1, todo: '试穿再决定' })],
    }),
  )
})
it('取消未保存核对不会发请求或修改事实', async () => {
  const op = operation()
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <Review session={session} operation={op} onDirty={vi.fn()} />
    </MemoryRouter>,
  )
  await user.click(screen.getByRole('button', { name: '核对这件' }))
  await user.type(screen.getByLabelText('留给自己的待办'), '还没决定')
  await user.click(screen.getByRole('button', { name: '取消未保存修改' }))
  expect(op.send).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '核对这件' }))
  expect(screen.getByLabelText('留给自己的待办')).toHaveValue('')
})
