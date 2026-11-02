import { expect, test } from '@playwright/test'

test('deployed care reads current garments and confirmation without writing', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const writes: string[] = [],
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  await page.goto('/wardrobe')
  await page.getByRole('link', { name: '洗衣与批量管理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '洗衣与批量管理' })).toBeVisible()
  const loaded = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/wardrobe/care?') &&
      new URL(r.url()).searchParams.get('group') === 'all' &&
      r.status() === 200,
  )
  await page.getByRole('button', { name: '全部单品', exact: true }).click()
  const items = (await (await loaded).json()).data.items
  await expect(page.locator('.care-item')).toHaveCount(items.length)
  await expect(page.getByText(/^已载入 \d+ 件/)).toBeVisible()
  const first = page.locator('.care-item').first()
  if (items.length) {
    await first.getByRole('checkbox').check()
    await page.getByRole('button', { name: '核对并继续' }).click()
    const dialog = page.getByRole('dialog', { name: '核对本次批量操作' })
    await expect(dialog.getByRole('button', { name: '确认对 1 件执行' })).toBeEnabled()
    await page.screenshot({ path: info.outputPath('deployed-confirmation.png') })
    await page.keyboard.press('Escape')
    await first.getByRole('link', { name: '查看状态与资料' }).click()
    await page.getByRole('link', { name: '返回洗衣与批量管理' }).click()
    await expect(page.getByRole('button', { name: '只看已选（1）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '只看已选（1）' })).toBeVisible()
    await page.getByRole('button', { name: '清空选择' }).click()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
