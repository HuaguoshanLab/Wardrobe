import { expect, test } from '@playwright/test'
import { garmentSchema } from '../src/features/wardrobe/api'
import type { Seasonal } from '../src/features/wardrobe/seasonal/api'

const sid = '00000000-0000-4000-8000-000000000041'
const gid = '00000000-0000-4000-8000-000000000042'
const second = '00000000-0000-4000-8000-000000000043'
test('W4 grouped reviews, preserved selection, explicit confirmation and honest summary', async ({
  page,
  request,
}, info) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const data = (await (await request.get('/api/v1/garments?limit=1')).json()).data
  const garment = garmentSchema.parse(data.items[0])
  const first = { ...garment, id: gid, version: 2, name: '通勤衬衫', is_demo: false }
  const other = { ...first, id: second, name: '长名称衣服LongUnbrokenName'.repeat(3) }
  const inventory: Seasonal['inventory'] = {
    plan: { season: 'autumn', version: 1, city: '', period: '', notes: '', rows: [] },
    stats_at: '2026-10-29T08:00:00Z',
    config_versions: { autumn: 1 },
    counts: [],
    garments: [],
    total_owned: 2,
  }
  const items: Seasonal['items'] = [
    {
      garment_id: gid,
      original: first,
      current: first,
      reviewed_version: 1,
      stale: true,
      todo: '需要试穿',
    },
    {
      garment_id: second,
      original: other,
      current: other,
      reviewed_version: 2,
      stale: false,
      todo: '',
    },
  ]
  const actions: Seasonal['actions'] = [
    {
      id: sid,
      garment_id: gid,
      operation: {
        expected_version: 1,
        action: 'storage',
        occurred_on: '2026-10-29',
        reason: '',
        changes: { storage: 'stored' },
        related_event_id: null,
        impact_token: null,
      },
      success: false,
      message: '衣服已变化，请重新核对',
      garment: null,
    },
  ]
  const summary: Seasonal['preview'] = {
    stats_at: inventory.stats_at,
    rules_token: 'rules',
    inventory,
    items,
    actions,
    reviewed: 1,
    total: 2,
    unresolved: [
      '通勤衬衫：核对已过期',
      ...Array.from({ length: 8 }, (_, i) => `遗留待办 ${i + 1}`),
    ],
    outside_scope: 0,
  }
  let session: Seasonal = {
    id: sid,
    version: 1,
    season: 'autumn',
    scope: 'all',
    categories: [],
    stage: 'review',
    created_at: inventory.stats_at,
    completed_at: null,
    items,
    actions,
    inventory,
    target_token: 'rules',
    targets_confirmed: false,
    preview_token: 'preview',
    preview: summary,
    summary: null,
  }
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(route.request().url())
      return route.abort()
    }
    const url = new URL(route.request().url())
    if (url.pathname === `/api/v1/seasonal-sessions/${sid}`)
      return route.fulfill({ json: { data: session, request_id: sid } })
    if (url.pathname === '/api/v1/seasonal-sessions')
      return route.fulfill({
        json: {
          data: {
            items: [session, { ...session, id: second, completed_at: inventory.stats_at }],
            next_cursor: null,
          },
          request_id: sid,
        },
      })
    return route.continue()
  })
  await page.goto('/wardrobe/seasonal')
  await expect(page.getByRole('heading', { name: '继续未完成的整理' })).toBeVisible()
  await expect(page.getByRole('link', { name: /查看总结/ })).toBeHidden()
  await page.getByText('历史总结 · 1 轮', { exact: true }).click()
  await expect(page.getByRole('link', { name: /查看总结/ })).toBeVisible()
  await page.screenshot({ path: info.outputPath('w4-records.png'), animations: 'disabled' })
  await page.goto(`/wardrobe/seasonal/${sid}`)
  await page.getByRole('button', { name: /有待办\s*1/ }).click()
  await page.getByRole('searchbox', { name: '搜索本轮单品' }).fill('试穿')
  await page.reload()
  await expect(page.getByRole('searchbox', { name: '搜索本轮单品' })).toHaveValue('试穿')
  await expect(page.getByRole('button', { name: /有待办\s*1/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.screenshot({ path: info.outputPath('w4-review.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '重新核对', exact: true }).click()
  await page.getByLabel('留给自己的待办').fill('保留草稿')
  await expect(page.getByRole('button', { name: '继续：调整目标' })).toBeDisabled()
  await page.getByRole('link', { name: '暂停整理，稍后继续' }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('留给自己的待办')).toHaveValue('保留草稿')
  await page.getByRole('button', { name: '取消未保存修改' }).click()
  session = { ...session, stage: 'actions' }
  await page.reload()
  await page.getByRole('button', { name: /上次未成功\s*1/ }).click()
  await page.locator('.seasonal-pick').getByRole('checkbox').check()
  await page.getByRole('button', { name: /全部可处理\s*2/ }).click()
  await expect(
    page.locator('.seasonal-pick').filter({ hasText: '通勤衬衫' }).getByRole('checkbox'),
  ).toBeChecked()
  const trigger = page.getByRole('button', { name: '核对并执行 · 1 件', exact: true })
  await trigger.click()
  await expect(page.getByRole('dialog')).toContainText('通勤衬衫')
  await expect(page.getByRole('button', { name: '确认执行换季收纳' })).toBeDisabled()
  await page.getByLabel('我已核对对象与动作，确认现在执行').check()
  await expect(page.getByRole('button', { name: '确认执行换季收纳' })).toBeEnabled()
  await page.getByRole('button', { name: '返回修改', exact: true }).click()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(page.getByLabel('我已核对对象与动作，确认现在执行')).not.toBeChecked()
  await page.screenshot({ path: info.outputPath('w4-confirm-initial.png'), animations: 'disabled' })
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 844, height: 390 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => innerWidth)).toBe(viewport.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect
      .poll(async () => {
        const rect = await page.getByRole('button', { name: '确认执行换季收纳' }).boundingBox()
        return rect ? rect.y + rect.height : Infinity
      })
      .toBeLessThanOrEqual(viewport.height)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({ path: info.outputPath('w4-confirm.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '返回修改', exact: true }).click()
  await page.getByRole('button', { name: '取消未执行选择' }).click()
  session = { ...session, stage: 'summary' }
  await page.reload()
  await expect(page.getByRole('button', { name: '返回核对已变化单品' })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回确认目标', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存本轮总结' })).toBeDisabled()
  await expect(page.getByText('遗留待办 8', { exact: true })).toBeHidden()
  await page.getByText('展开其余 4 项', { exact: true }).click()
  await expect(page.getByText('遗留待办 8', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存本轮总结' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('w4-review-summary.png') })
  session = { ...session, completed_at: inventory.stats_at, summary }
  await page.reload()
  await expect(page.getByRole('heading', { name: '本轮总结已保存' })).toBeVisible()
  await expect(page.getByRole('button', { name: '读取最新状态' })).toHaveCount(0)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
