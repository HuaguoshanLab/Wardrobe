import { expect, test } from '@playwright/test'

test('deployed rotation controls persist locally without requests or overflow', async ({
  page,
}, info) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', async (route) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      writes.push(route.request().url())
      await route.abort()
    } else await route.continue()
  })
  await page.goto('/outfits/prepare')
  await expect(page.getByRole('radio', { name: /正常推荐/ })).toBeVisible()
  await page.getByRole('radio', { name: /尽量避开近期组合/ }).check()
  await page.reload()
  await expect(page.getByRole('radio', { name: /尽量避开近期组合/ })).toBeChecked()
  await expect(page.locator('.rotation-option').first()).toHaveCSS('flex-direction', 'row')
  await page.getByRole('radio', { name: /优先近期少穿/ }).check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .locator('.rotation-choice')
    .screenshot({ path: info.outputPath('rotation-readonly.png') })
  await page.goto('/collections')
  await expect(page.getByRole('heading', { name: '穿搭记录', exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
  expect(writes).toEqual([])
})
