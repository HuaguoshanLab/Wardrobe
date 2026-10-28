import { expect, test } from '@playwright/test'

const id = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const envelope = (data: unknown) => ({ data, request_id: id })
const revision = {
  id,
  session_id: id,
  parent_revision_id: null,
  run_id: id,
  items: [],
  reason: '保存时的搭配说明',
  unmet_requirements: [],
  weather_snapshot: {},
  request_snapshot: {},
  provider_mode: 'fake',
  created_at: '2026-10-01T00:00:00Z',
}

test('four tabs, complete month markers and detail return preserve calendar context', async ({
  page,
}, testInfo) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(request.url())
  })
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient')
    if (url.pathname.endsWith('/wear-records'))
      return route.fulfill({
        json: envelope({
          items: [
            {
              id: url.searchParams.has('cursor') ? other : id,
              revision_id: url.searchParams.has('cursor') ? other : id,
              worn_on: today(),
              timezone: 'Asia/Shanghai',
              notes: '当天记录',
              version: 1,
              created_at: '',
              revision: { ...revision, id: url.searchParams.has('cursor') ? other : id },
            },
          ],
          next_cursor: url.searchParams.has('cursor') ? null : id,
        }),
      })
    if (url.pathname.endsWith('/favorites'))
      return route.fulfill({ json: envelope({ items: [], next_cursor: null }) })
    if (url.pathname.includes('/outfit-revisions/'))
      return route.fulfill({ json: envelope(revision) })
    return route.continue()
  })
  await page.goto('/calendar')
  await expect(page).toHaveURL(/\/collections\?view=calendar/)
  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(4)
  await expect(page.getByRole('navigation').getByRole('link', { name: '穿搭记录' })).toHaveClass(
    'active',
  )
  await expect(page.getByRole('button', { name: `${today()}，2 套穿着` })).toBeVisible()
  await expect(page.locator('.record-card')).toHaveCount(2)
  await page.locator('.record-card-link').first().click()
  await page.getByRole('link', { name: '返回穿搭记录' }).click()
  await expect(page.getByRole('button', { name: '日历', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.record-card')).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('calendar.png'), animations: 'disabled' })
  expect(writes).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('favorite form protects draft and history removal only writes after explicit confirmation', async ({
  page,
}) => {
  const writes: { method: string; body: unknown; version?: string }[] = []
  let hidden = false
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/favorites') && request.method() === 'GET')
      return route.fulfill({ json: envelope({ items: [], next_cursor: null }) })
    if (path.endsWith('/outfit-revisions') && request.method() === 'GET')
      return route.fulfill({
        json: envelope({
          items: hidden ? [] : [{ revision, version: 7, hidden_from_history_at: null }],
          next_cursor: null,
        }),
      })
    if (request.method() !== 'GET') {
      writes.push({
        method: request.method(),
        body: request.postDataJSON(),
        version: request.headers()['if-match'],
      })
      if (request.method() === 'DELETE') hidden = true
      return route.fulfill({ json: envelope({ deleted: true }) })
    }
    return route.continue()
  })
  await page.goto('/collections?view=history')
  await page.getByRole('button', { name: '收藏这套', exact: true }).click()
  await page.getByLabel('收藏名称（选填）').fill('保留草稿')
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true })).toBeHidden()
  await expect(page.getByLabel('收藏名称（选填）')).toHaveValue('保留草稿')
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '放弃修改' }).click()
  expect(writes).toEqual([])
  await page.getByRole('button', { name: '更多搭配操作' }).click()
  await page.getByRole('button', { name: '从历史移除', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('收藏、穿着记录和原始快照仍保留')
  expect(writes).toEqual([])
  await page.getByRole('button', { name: '确认从历史移除' }).click()
  await expect(page.getByRole('heading', { name: '第一套搭配，从今天开始' })).toBeVisible()
  expect(writes).toEqual([{ method: 'DELETE', body: null, version: '7' }])
})

test('real archive and snapshot previews keep the palette, load pictures and browse without writes', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'),
  )
  await page.goto('/collections?view=history')
  await expect(page.locator('.record-card').first()).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.record-card')
        .first()
        .locator('img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true)
  if (page.viewportSize()!.width <= 760) {
    const card = page.locator('.record-card').first()
    expect((await card.boundingBox())!.height).toBeLessThan(220)
    const photos = await card.locator('.record-composition img').all()
    const firstPhoto = await photos[0].boundingBox()
    for (const photo of photos.slice(0, 3)) {
      expect(Math.abs((await photo.boundingBox())!.y - firstPhoto!.y)).toBeLessThan(1)
    }
    const buttons = await card.locator('.record-card-actions > button').all()
    for (const button of buttons)
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await page.screenshot({ path: testInfo.outputPath('history.png'), animations: 'disabled' })
  await page.locator('.record-card-link').first().click()
  await expect(page.locator('.snapshot-piece').first()).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator('.snapshot-piece img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('detail.png'), animations: 'disabled' })
  await page.locator('.snapshot-piece').first().click()
  await expect(page.getByRole('dialog')).toContainText('保存搭配时的图片与属性')
  await page.screenshot({ path: testInfo.outputPath('piece.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '记录穿着', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('同一天可以记录不同搭配')
  await page.screenshot({ path: testInfo.outputPath('wear.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('link', { name: '返回穿搭记录' }).click()
  await page.getByRole('button', { name: '日历', exact: true }).click()
  await expect(page.getByRole('region', { name: '穿着月历' })).toHaveAttribute('aria-busy', 'false')
  await page.screenshot({ path: testInfo.outputPath('calendar-live.png'), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
