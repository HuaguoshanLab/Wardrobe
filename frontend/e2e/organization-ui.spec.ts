import { expect, test } from '@playwright/test'

test('W3 read-only navigation, drafts, impact and mobile controls', async ({
  page,
  request,
}, info) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url())
    return route.abort()
  })
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }))
  await page.goto('/wardrobe')
  await page.getByRole('link', { name: '补充与处理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '补充与处理', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '手工添加', exact: true }).click()
  await page.getByLabel('计划名称', { exact: true }).fill('长名称 衣服LongUnbrokenName'.repeat(3))
  await page.getByLabel('计划数量', { exact: true }).fill('2')
  await page.getByRole('link', { name: '返回补充计划', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('计划数量', { exact: true })).toHaveValue('2')
  for (const viewport of [
    { width: 320, height: 680 },
    { width: 844, height: 390 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({ path: info.outputPath('w3-plan-form.png'), fullPage: true })
  await page.getByRole('link', { name: '返回补充计划', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.getByRole('button', { name: '观察与处理', exact: true }).click()
  await page.getByRole('button', { name: '已保留', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '已保留', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByText('正在核对衣橱与目标…', { exact: true })).toBeHidden()
  await page.screenshot({ path: info.outputPath('w3-board.png'), fullPage: true })
  const garments = (await (await request.get('/api/v1/garments?ownership=owned&limit=100')).json())
    .data.items
  const g = garments.find((g: { is_demo: boolean }) => !g.is_demo)
  if (g) {
    await page.goto(`/wardrobe/organization/garments/${g.id}`)
    await page.getByRole('button', { name: '执行实际处理', exact: true }).click()
    await page.getByLabel('实际处理方式', { exact: true }).selectOption('gifted')
    await expect(
      page.getByRole('heading', { name: '退出后，会影响这些需求', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '确认退出衣橱', exact: true })).toBeDisabled()
    await page.getByLabel('已核对全部季节影响，确认实际退出', { exact: true }).check()
    await expect(page.getByRole('button', { name: '确认退出衣橱', exact: true })).toBeEnabled()
    await expect
      .poll(() =>
        page.getByRole('button', { name: '确认退出衣橱', exact: true }).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return r.top >= 0 && r.bottom <= innerHeight
        }),
      )
      .toBe(true)
    await page.screenshot({ path: info.outputPath('w3-confirmation.png') })
    await page.getByRole('button', { name: '关闭面板', exact: true }).click()
    await page.getByRole('button', { name: '继续填写', exact: true }).click()
    await expect(page.getByLabel('实际处理方式', { exact: true })).toHaveValue('gifted')
  }
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
