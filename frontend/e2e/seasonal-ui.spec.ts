import { expect, test } from '@playwright/test'

test('W4 read-only entry, create cancellation and responsive navigation', async ({
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
  await page.goto('/wardrobe')
  await page.getByRole('link', { name: '换季整理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '换季整理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选择季节与范围' }).click()
  await page.getByLabel('整理季节').selectOption('autumn')
  await page.getByLabel('整理范围').selectOption('all')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '选择季节与范围' })).toBeVisible()
  await page.getByRole('button', { name: '选择季节与范围' }).click()
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 844, height: 390 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => innerWidth)).toBe(viewport.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByRole('heading', { name: '换季整理', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('w4-entry.png'), fullPage: true })
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
