import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('W3 clear progress, decision choices, return context and impact hierarchy', async ({
  page,
  request,
}, info) => {
  const garments = (await (await request.get('/api/v1/garments?ownership=owned&limit=100')).json())
    .data.items
  const g = garments.find((g: { is_demo: boolean }) => !g.is_demo)
  expect(g).toBeTruthy()
  const ids = Array.from({ length: 4 }, () => randomUUID())
  const sources = [
    { id: ids[2], season: 'spring', name: '春季通勤衬衫', active: true },
    { id: ids[3], season: 'autumn', name: '秋季日常轮换', active: true },
  ]
  const plan = {
    id: ids[0],
    version: 1,
    name: '通勤衬衫补充',
    quantity: 3,
    budget: '600',
    reason: '补足洗衣间隔的日常轮换',
    notes: '',
    status: 'purchased',
    cancelled_quantity: 1,
    remaining: 1,
    sources,
    linked: [{ id: g.id, name: '已经入库的衬衫', archived: false }],
  }
  const closed = {
    ...plan,
    id: ids[1],
    name: '已结束的外套计划',
    quantity: 2,
    cancelled_quantity: 1,
    remaining: 0,
    status: 'completed',
  }
  const candidate = {
    garment_id: g.id,
    garment_version: g.version,
    name: '留作轮换的衬衫',
    image_url: g.image_url,
    reason_key: 'manual',
    reason: '已超过自定目标；是否保留由你决定。',
    decision_version: 1,
    state: 'keep',
    note: '仍适合出差时轮换，不需要因为超额而丢弃。',
    current: true,
    archived: false,
  }
  const board = {
    shortages: [{ source: sources[0], difference: 2, planned: 2, needs_attention: 0 }],
    candidates: [candidate],
    next_cursor: null,
    stats_at: new Date().toISOString(),
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
    let data: unknown
    if (path === '/api/v1/supply-plans') data = { items: [plan, closed], next_cursor: null }
    if (path === `/api/v1/supply-plans/${plan.id}`) data = plan
    if (path === '/api/v1/organization' || path === `/api/v1/organization/${g.id}`) data = board
    if (path === `/api/v1/organization/${g.id}/exit-impact`)
      data = {
        garment_id: g.id,
        garment_version: g.version,
        token: 'read-only-preview',
        invalid_sources: [],
        rows: sources.map((source) => ({
          source,
          lower: 2,
          upper: 4,
          before_confirmed: 2,
          after_confirmed: 1,
          before_pending: 0,
          after_pending: 0,
          conclusion: 'shortage',
          difference: 1,
        })),
      }
    return data ? route.fulfill({ json: { data, request_id: randomUUID() } }) : route.continue()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/wardrobe/organization')
  await expect(page.getByRole('heading', { name: plan.name })).toBeVisible()
  await expect(page.getByRole('heading', { name: closed.name })).toBeHidden()
  await page.getByText('已结束的计划 · 1 项', { exact: true }).click()
  await expect(page.getByRole('heading', { name: closed.name })).toBeVisible()
  await page.getByText('查看数量缺口 · 1 项需求', { exact: true }).click()
  await expect(page.getByText('已有计划覆盖当前缺口，请先核对计划进度。')).toBeVisible()
  await expect(page.getByRole('link', { name: '核对这项需求' })).toHaveAttribute(
    'href',
    new RegExp(`focus=${sources[0].id}`),
  )
  await page.screenshot({ path: info.outputPath('w3-redesign-plans.png'), fullPage: true })
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: plan.name }) })
    .click()
  await expect(page).toHaveURL(new RegExp(`/plans/${plan.id}$`))
  await expect(page.getByRole('heading', { name: '补充计划', exact: true })).toBeVisible()
  await expect(page.getByText('其中 1 件已取消补充，未计入库存')).toBeVisible()
  await page.getByRole('button', { name: '取消剩余 1 件', exact: true }).click()
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消剩余 1 件', exact: true })).toBeFocused()
  await page.getByRole('link', { name: '返回整理清单' }).click()
  await page.getByRole('button', { name: '观察与处理', exact: true }).click()
  await page.getByRole('button', { name: '已保留', exact: true }).click()
  await page.reload()
  const selected = page.getByRole('button', { name: '已保留', exact: true })
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() =>
      selected.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth
      }),
    )
    .toBe(true)
  await page.screenshot({ path: info.outputPath('w3-redesign-decisions.png'), fullPage: true })
  await page.getByRole('link', { name: '复核保留决定' }).click()
  await expect(page.getByRole('radio', { name: /^继续保留/ })).toBeChecked()
  await page.getByRole('radio', { name: /^列为待处理/ }).check()
  await page.getByRole('link', { name: '返回观察与处理' }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByRole('radio', { name: /^列为待处理/ })).toBeChecked()
  await page.getByRole('link', { name: '返回观察与处理' }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: '复核保留决定' }).click()
  await expect(page.getByRole('radio', { name: /^继续保留/ })).toBeChecked()
  await page.screenshot({ path: info.outputPath('w3-redesign-choice-initial.png'), fullPage: true })
  for (const viewport of [
    { width: 320, height: 680 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => innerWidth)).toBe(viewport.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(
      await page
        .getByRole('radio')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(24)
  }
  await page.reload()
  await expect(page.getByRole('radio', { name: /^继续保留/ })).toBeChecked()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('w3-redesign-choice.png') })
  await page.getByRole('button', { name: '执行实际处理', exact: true }).click()
  await page.getByLabel('实际处理方式', { exact: true }).selectOption('gifted')
  await expect(page.getByText('2 个季节 · 2 项需求受影响', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认退出衣橱', exact: true })).toBeDisabled()
  await page.getByLabel('已核对全部季节影响，确认实际退出', { exact: true }).check()
  await expect(page.getByRole('button', { name: '确认退出衣橱', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('w3-redesign-impact.png') })
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
