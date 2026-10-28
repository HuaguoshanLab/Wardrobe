import { expect, test } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )
})
test('Back dismisses sheet and close leaves no extra history', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('link', { name: '我的衣橱', exact: true }).click()
  await page.getByRole('button', { name: /^筛选/ }).click()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL('/wardrobe')
  await expect.poll(() => page.evaluate(() => !!history.state?.__wardrobeSheet)).toBe(false)
  await page.goBack()
  await expect(page).toHaveURL('/settings')
  await page.getByRole('link', { name: '我的衣橱', exact: true }).click()
  await page.getByRole('button', { name: /^筛选/ }).click()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect.poll(() => page.evaluate(() => !!history.state?.__wardrobeSheet)).toBe(false)
  await page.goBack()
  await expect(page).toHaveURL('/settings')
})
test('tag drafts survive Back and nested confirmation; discard clears history', async ({
  page,
}, info) => {
  await page.goto('/settings')
  await page.getByRole('link', { name: '我的衣橱', exact: true }).click()
  await page.getByRole('button', { name: '管理标签' }).click()
  await page.getByLabel('新标签', { exact: true }).fill('尚未保存的标签')
  await page.goBack()
  const confirm = page.getByRole('dialog', { name: '放弃未保存的标签？' })
  await expect(confirm).toBeVisible()
  await page.goBack()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByLabel('新标签', { exact: true })).toHaveValue('尚未保存的标签')
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(confirm).toBeVisible()
  await page.screenshot({ path: info.outputPath('tag-discard.png') })
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => !!history.state?.__wardrobeSheet)).toBe(false)
  await page.goBack()
  await expect(page).toHaveURL('/settings')
})
test('small-screen upload entry is visible and editable text stays 16px', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 667 })
  for (const [path, label] of [
    ['/settings/preferences', '偏好补充'],
    ['/outfits/prepare', '本次补充要求'],
  ]) {
    await page.goto(path)
    await expect(page.getByLabel(label, { exact: true })).toHaveCSS('font-size', '16px')
  }
  await page.goto('/imports')
  const picker = page.locator('.import-file-picker')
  await expect(picker).toBeVisible()
  const bounds = await picker.boundingBox()
  const nav = await page.locator('.sidebar').boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThan(nav!.y)
  await page.screenshot({ path: info.outputPath('upload-small.png') })
  await page.goto('/')
  await page.screenshot({ path: info.outputPath('today-small.png') })
})

test('route-backed adjustment closes without reopening on Back', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('link', { name: '今日穿搭', exact: true }).click()
  await page.getByRole('button', { name: '调整这套', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '调整这套', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).not.toHaveURL(/adjust=1/)
  await expect.poll(() => page.evaluate(() => !!history.state?.__wardrobeSheet)).toBe(false)
  await page.goBack()
  await expect(page).toHaveURL('/settings')
})
