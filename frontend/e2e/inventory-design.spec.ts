import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('W2 focused filters, quantity drilldown, return context and direct target editing', async ({
  page,
  request,
}, info) => {
  const sample = (await (await request.get('/api/v1/garments?limit=1')).json()).data.items[0]
  const ids = Array.from({ length: 7 }, () => randomUUID())
  const names = [
    '通勤衬衫',
    '日常下装',
    '运动上装',
    '换季外套',
    '周末休闲',
    '暂不考虑的配饰',
    '失效标签需求',
  ]
  const states = ['review', 'shortage', 'enough', 'excess', 'unset', 'disabled', 'invalid']
  const rows = ids.map((id, i) => ({
    id,
    name: names[i],
    category: i === 1 ? 'bottom' : 'top',
    subtype_ids: [],
    tag_ids: [],
    occasion_codes: [],
    lower: i === 4 ? null : i === 0 ? 1 : 3,
    upper: i === 4 ? null : 5,
    enabled: i !== 5,
    notes: '',
    estimate: null,
  }))
  const counts = ids.map((row_id, i) => ({
    row_id,
    matched_owned: i === 0 ? 1 : i === 2 ? 3 : i === 3 ? 8 : 0,
    confirmed: i === 0 ? 0 : i === 2 ? 3 : i === 3 ? 8 : 0,
    pending: i === 0 ? 1 : 0,
    available: 0,
    unavailable: 0,
    needs_attention: 0,
    shared: 0,
    conclusion: states[i],
    difference: i === 1 ? 3 : i === 3 ? 3 : null,
    rule_errors: i === 6 ? ['引用的标签已删除，请编辑需求移除或替换'] : [],
    members:
      i === 0
        ? [
            {
              garment_id: sample.id,
              bucket: 'pending',
              reasons: ['衣物状况待确认'],
              covered_by: [],
            },
          ]
        : [],
  }))
  const plan = { season: 'summer', version: 1, city: '上海', period: '5–9 月', notes: '', rows }
  const snapshot = {
    plan,
    stats_at: new Date().toISOString(),
    config_versions: { summer: 1 },
    total_owned: 12,
    counts,
    garments: [
      { id: sample.id, name: '白色通勤衬衫', image_url: sample.image_url, version: sample.version },
    ],
  }
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(route.request().url())
      return route.abort()
    }
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/inventory/summer')
      return route.fulfill({ json: { data: snapshot, request_id: randomUUID() } })
    return route.continue()
  })
  await page.goto('/wardrobe/inventory?season=summer')
  await expect(page.locator('.inventory-row')).toHaveCount(7)
  await page.getByRole('button', { name: '待核对 2', exact: true }).click()
  await expect(page.locator('.inventory-row')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: '通勤衬衫', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '失效标签需求', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '核对通勤衬衫待核对 1 件', exact: true }).click()
  await expect(page.getByRole('button', { name: '待核对 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('link', { name: /白色通勤衬衫/ }).click()
  await page.getByRole('link', { name: '返回盘点', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '通勤衬衫 · 单品明细', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '待核对 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await expect(page.getByRole('button', { name: '待核对 2', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '需调整 2', exact: true }).click()
  await expect(page.getByRole('heading', { name: '日常下装', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '换季外套', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '全部 7', exact: true }).click()
  await page.screenshot({ path: info.outputPath('w2-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('w2-first-screen.png'), animations: 'disabled' })
  await page.screenshot({
    path: info.outputPath('w2-overview.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('link', { name: '修改通勤衬衫目标', exact: true }).click()
  await expect(page.getByLabel('需求名称', { exact: true })).toHaveValue('通勤衬衫')
  await expect(page.getByLabel('目标下限', { exact: true })).toHaveValue('1')
  await page.getByRole('button', { name: '暂不设目标', exact: true }).click()
  await expect(page.getByLabel('目标下限', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('目标上限', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '应用到本季草稿', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const first = page
    .locator('.inventory-draft-row')
    .filter({ has: page.getByRole('heading', { name: '通勤衬衫', exact: true }) })
  await first.getByText('排序与删除', { exact: true }).click()
  await first.getByRole('button', { name: '下移通勤衬衫', exact: true }).click()
  await expect(page.locator('.inventory-draft-row').nth(1)).toContainText('通勤衬衫')
  await expect(page.getByRole('status')).toContainText('移至第 2 条')
  await first.getByRole('button', { name: '删除通勤衬衫', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('通勤衬衫')
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await expect(page.locator('.inventory-draft-row')).toHaveCount(7)
  for (const viewport of [
    { width: 320, height: 680 },
    { width: 844, height: 390 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '新增需求', exact: true }).click()
  await page
    .getByLabel('需求名称', { exact: true })
    .fill('长名字的日常上装 LongUnbrokenName'.repeat(2))
  await expect(page.getByLabel('目标下限', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      page.getByRole('button', { name: '应用到本季草稿', exact: true }).evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= innerHeight
      }),
    )
    .toBe(true)
  await page.screenshot({ path: info.outputPath('w2-target-form.png'), animations: 'disabled' })
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})

test('W2 subtype suggestions fill the draft and search never writes', async ({ page }, info) => {
  const writes: string[] = []
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url())
    return route.abort()
  })
  await page.goto('/wardrobe/inventory/subtypes?season=summer')
  await page.getByLabel('查找子类', { exact: true }).fill('没有这个子类的测试名称')
  await expect(page.getByRole('status')).toContainText('没有匹配的子类')
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await page.getByRole('button', { name: '新增子类', exact: true }).click()
  await page.getByRole('button', { name: '衬衫', exact: true }).click()
  await expect(page.getByLabel('子类名称', { exact: true })).toHaveValue('衬衫')
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('子类名称', { exact: true })).toHaveValue('衬衫')
  await page.screenshot({ path: info.outputPath('w2-subtypes.png'), animations: 'disabled' })
  expect(writes).toEqual([])
})
