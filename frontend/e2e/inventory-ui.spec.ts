import { expect, test } from '@playwright/test'

test('W2 real read-only pages, nested drafts and narrow screen controls', async ({
  page,
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
  await page.getByRole('link', { name: '四季盘点', exact: true }).click()
  for (const name of ['春 季', '夏 季', '秋 季', '冬 季']) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByText('件真实持有 · 全衣橱去重', { exact: true })).toBeVisible()
  }
  await page.getByRole('link', { name: '编辑本季目标', exact: true }).click()
  await page.getByRole('button', { name: '新增需求', exact: true }).click()
  const longName = '用于上下班与日常轮换的衣服 LongUnbrokenName'.repeat(2)
  await page.getByLabel('需求名称', { exact: true }).fill(longName)
  await page.getByLabel('目标下限', { exact: true }).fill('0')
  await page.getByLabel('目标上限', { exact: true }).fill('0')
  await page.goBack()
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('需求名称', { exact: true })).toHaveValue(longName)
  for (const viewport of [
    { width: 320, height: 680 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect
      .poll(() =>
        page.getByRole('button', { name: '应用到本季草稿', exact: true }).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return r.top >= 0 && r.bottom <= innerHeight
        }),
      )
      .toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ animations: 'disabled', path: info.outputPath('inventory-draft.png') })
  await page.getByRole('button', { name: '应用到本季草稿', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '新增需求', exact: true }).click()
  await page.getByLabel('需求名称', { exact: true }).fill('只放弃这一条')
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('inventory-editor.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: '返回盘点', exact: true }).first().click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('heading', { name: '四季盘点', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '四季盘点', exact: true })).toBeVisible()
  expect(writes).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('inventory-readonly.png'),
    fullPage: true,
  })
})
