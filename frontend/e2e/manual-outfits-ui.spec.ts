import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 844, height: 390 },
]) {
  test(`manual form and picker remain usable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const writes: string[] = []
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/api/v1/**', async (route) => {
      if (route.request().method() !== 'GET') {
        writes.push(route.request().url())
        await route.abort()
      } else await route.continue()
    })
    await page.goto('/collections/manual')
    await expect(page.getByRole('heading', { name: '手动搭配', exact: true })).toBeVisible()
    await page.getByLabel('直接记录实际穿着', { exact: true }).check()
    await page.getByLabel('穿着备注（选填）').fill('长备注'.repeat(100))
    await expect(page.getByRole('button', { name: '确认记录穿着' })).toBeDisabled()
    await page.getByRole('button', { name: '选择衣服', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.getByLabel('搜索衣服名称').fill('不存在的验收单品')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByText('没有匹配的正式单品，可调整筛选或先录入衣服。')).toBeVisible()
    await page.getByRole('button', { name: '完成选择（0 件）' }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('manual-picker.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: '选择衣服', exact: true })).toBeFocused()
    await page.getByLabel('实际穿着日期').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('manual-form-bottom.png') })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: info.outputPath('manual-form.png') })
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
