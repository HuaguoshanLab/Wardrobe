import { expect, test } from '@playwright/test'

test('lifecycle browsing and closing forms never write or generate', async ({
  page,
  request,
}, info) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  const response = await request.get('/api/v1/garments?limit=1')
  expect(response.ok()).toBeTruthy()
  const item = (await response.json()).data.items[0]
  expect(item).toBeTruthy()
  await page.goto(`/wardrobe/${item.id}`)
  await page.getByRole('link', { name: '生命周期 · 获得、收纳与整理' }).click()
  await expect(page.getByRole('heading', { name: '单品生命周期', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '补充获得资料', exact: true }).click()
  await expect(page.getByLabel('购入金额（元）', { exact: true })).toBeVisible()
  await expect(page.getByLabel('子类', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.getByRole('button', { name: '补充获得资料', exact: true })).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '退出衣橱', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认退出衣橱' })).toBeVisible()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '生命周期记录' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('lifecycle-readonly.png'), fullPage: true })
})

test('W1 nested editor preserves draft on browser back and restores focus', async ({
  page,
  request,
}, info) => {
  const item = (await (await request.get('/api/v1/garments?limit=1')).json()).data.items[0]
  const writes: string[] = []
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url())
    return route.abort()
  })
  await page.goto(`/wardrobe/${item.id}/lifecycle`)
  await page.getByRole('button', { name: '补充获得资料', exact: true }).click()
  await page.getByRole('textbox', { name: '收纳位置', exact: true }).fill('卧室衣柜第二层')
  await page.getByRole('button', { name: '新增子类', exact: true }).click()
  await page.getByLabel('子类名称').fill('未保存的子类')
  await page.goBack()
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '收纳位置', exact: true })).toHaveValue(
    '卧室衣柜第二层',
  )
  await expect(page.getByRole('button', { name: '新增子类', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '收纳位置', exact: true })).toHaveValue(
    '卧室衣柜第二层',
  )
  await expect
    .poll(async () =>
      page.getByRole('button', { name: '保存记录' }).evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= innerHeight
      }),
    )
    .toBe(true)
  await page.screenshot({ path: info.outputPath('lifecycle-profile.png') })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.getByRole('button', { name: /^收纳位置：/ }).click()
  await page.getByRole('radio', { name: '换季收纳' }).check()
  await expect(page.getByRole('radio', { name: '换季收纳' })).toBeChecked()
  await page.screenshot({ path: info.outputPath('lifecycle-storage.png') })
  expect(writes).toEqual([])
})

test('W1 archive, history, failed image and narrow layouts stay readable', async ({
  page,
  request,
}, info) => {
  const item = (await (await request.get('/api/v1/garments?limit=1')).json()).data.items[0]
  const eventId = '00000000-0000-4000-8000-000000000011'
  const writes: string[] = []
  await page.route('**/api/v1/**', (route) => {
    const r = route.request()
    if (r.method() !== 'GET') {
      writes.push(r.url())
      return route.abort()
    }
    const path = new URL(r.url()).pathname
    const envelope = (data: unknown) => route.fulfill({ json: { data, request_id: eventId } })
    if (path.endsWith(`/garments/${item.id}`))
      return envelope({
        ...item,
        name: '一件很长名字的秋冬外套 / LongNameWithoutSpaces'.repeat(3),
        ownership: 'retired',
        image_url: '/broken-w1-image.png',
        lifecycle: { ...item.lifecycle, exited_on: '2026-10-20', exit_reason: 'gifted' },
      })
    if (path.endsWith(`/garments/${item.id}/lifecycle`))
      return envelope({
        items: [
          {
            id: eventId,
            action: 'retire',
            occurred_on: '2026-10-20',
            recorded_at: '2026-10-20T08:00:00Z',
            version: 2,
            reason: '已经转赠，保留这段穿衣回忆。',
            related_event_id: null,
            before: { ownership: 'owned' },
            after: { ownership: 'retired', profile: { exit_reason: 'gifted' } },
          },
        ],
        next_cursor: null,
        wear_days: 12,
        first_worn_on: '2026-09-01',
        last_worn_on: '2026-10-01',
        last_exit_event_id: eventId,
      })
    return route.continue()
  })
  await page.route('**/broken-w1-image.png', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto(`/wardrobe/${item.id}/lifecycle`)
  await expect(page.getByText('图片暂不可用')).toBeVisible()
  await expect(page.getByRole('heading', { name: '日常管理' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '撤销退出', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '更正这条记录' })).toHaveCount(0)
  await page.getByText('详情与更正', { exact: true }).click()
  await expect(page.getByRole('button', { name: '更正这条记录' })).toBeVisible()
  for (const width of [375, 320, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 740 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 375, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addStyleTag({ content: '.lifecycle-page { zoom: 2; }' })
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll('.lifecycle-page *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .map((el) => ({
        tag: el.tagName,
        class: el.className,
        width: el.getBoundingClientRect().width,
      }))
      .slice(0, 12),
  )
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(overflow),
  ).toBe(true)
  await page.addStyleTag({ content: '.lifecycle-page { zoom: 1; }' })
  await page.screenshot({ path: info.outputPath('lifecycle-archive.png'), fullPage: true })
  await page.getByRole('button', { name: '撤销退出', exact: true }).click()
  await expect(page.getByLabel('本次说明')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认撤销退出' })).toBeVisible()
  expect(writes).toEqual([])
})
