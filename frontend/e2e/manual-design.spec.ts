import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('manual composition, unavailable confirmation and picker keep context on narrow screens', async ({
  page,
  request,
}, info) => {
  const response = await request.get('/api/v1/garments?ownership=owned')
  const rows = (await response.json()).data.items.filter((g: { is_demo: boolean }) => !g.is_demo)
  await page.route('**/manual-design-fixture.png', async (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
    }),
  )
  const names = ['浅色棉质衬衫', 'LongNameWithoutSpaces'.repeat(8), '暂不可用的深色外套']
  const items = names.map((name, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    version: 1,
    name,
    image_url:
      index === 1
        ? '/manual-image-missing.png'
        : rows.length
          ? rows[index % rows.length].image_url
          : '/manual-design-fixture.png',
    availability: index === 2 ? 'unavailable' : 'available',
    issue: '',
  }))
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/manual-image-missing.png', (r) => r.fulfill({ status: 404, body: '' }))
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(route.request().url())
      await route.abort()
    } else await route.continue()
  })
  await page.addInitScript((items) => {
    localStorage.setItem(
      'wardrobe.manual.new.draft',
      JSON.stringify({ items, mode: 'save', date: '2026-10-01', notes: '', acknowledged: false }),
    )
  }, items)
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.goto('/collections/manual')
  await expect(page.getByRole('button', { name: '移除：浅色棉质衬衫' })).toBeVisible()
  await expect(page.getByText('图片不可用', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存手动搭配' })).toBeDisabled()
  await page.getByLabel('直接记录实际穿着', { exact: true }).check()
  await page.getByLabel('实际穿着日期').fill('2999-01-01')
  await expect(page.getByText('请选择今天或过去的日期。')).toBeVisible()
  await page.getByLabel('实际穿着日期').fill('2026-10-01')
  await page.getByRole('checkbox').check()
  await expect(page.getByRole('button', { name: '确认记录穿着' })).toBeEnabled()
  await page.getByLabel('穿着备注（选填）').fill('补记一次日常穿搭，保留当前衣服状态。')
  await page.getByLabel('穿着备注（选填）').focus()
  const note = await page.getByLabel('穿着备注（选填）').boundingBox()
  const submit = await page.locator('.manual-submit-bar').boundingBox()
  expect(note!.y + note!.height).toBeLessThanOrEqual(submit!.y + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('wear-form.png') })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('composition.png') })
  await page.getByRole('button', { name: '选择衣服', exact: true }).click()
  await page.getByRole('button', { name: '已选（3）', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消选择：暂不可用的深色外套' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('selected-picker.png') })
  await page.getByRole('button', { name: '完成选择（3 件）' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Closing without changing the selection preserves the existing confirmation.
  await expect(page.getByRole('checkbox')).toBeChecked()
  await page.addStyleTag({
    content:
      '.manual-page { font-size: 20px } .manual-page button, .manual-page input, .manual-page textarea { font-size: 20px } .manual-page small { font-size: 16px }',
  })
  await page.getByLabel('穿着备注（选填）').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
