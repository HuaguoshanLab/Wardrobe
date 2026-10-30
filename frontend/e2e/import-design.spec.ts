import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const id = '00000000-0000-4000-8000-000000000071'
const envelope = (data: unknown) => ({ data, request_id: id })
const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  row_number: n,
  filename: `shirt-${n}.png`,
  image_asset_id: id,
  image_url: '/design-shirt.png',
  has_cutout: true,
  version: 1,
  touched_fields: [],
  validation_errors: [],
  processing_errors: {},
  row_status: 'ready',
  conversion_status: 'succeeded',
  analysis_status: 'succeeded',
  cutout_status: 'succeeded',
  analysis_notes: ['袖口细节请按实物核对'],
  analysis_source: 'qwen',
  confirmed_garment_id: null,
  draft: {
    name: `白色衬衫 ${n}`,
    category: 'top',
    subtype_name: '衬衫',
    color_codes: [],
    seasons: ['spring'],
    occasion_codes: [],
    style_codes: [],
    material: null,
    thickness: null,
    warmth: null,
    custom_tag_ids: [],
    availability: 'available',
    display_variant: 'original',
  },
})
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'),
  )
  await page.route('**/design-shirt.png', async (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
    }),
  )
})

test('模板准备在文件选择之前，窄屏保持入口清晰', async ({ page }, info) => {
  if (info.project.name === 'mobile-chromium')
    await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/imports')
  await page.getByRole('button', { name: /导入 Excel/ }).click()
  const download = page.getByRole('link', { name: /下载 Excel 模板/ })
  const picker = page.getByLabel('上传 Excel')
  expect((await download.boundingBox())!.y).toBeLessThan((await picker.boundingBox())!.y)
  await expect(page.getByRole('button', { name: '上传并检查 Excel' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('excel-entry.png'), fullPage: true })
})

test('进度来自实际状态，错误可重置，分组直达与错误焦点有效', async ({ page }, info) => {
  if (info.project.name === 'mobile-chromium')
    await page.setViewportSize({ width: 320, height: 568 })
  const rows = [
    row(1),
    {
      ...row(2),
      row_status: 'invalid',
      analysis_status: 'running',
      processing_errors: { price: '购入金额（元）字段不合法' },
    },
  ]
  await page.route(`**/api/v1/imports/${id}`, (route) =>
    route.fulfill({
      json: envelope({
        id,
        source: 'photos',
        parent_job_id: id,
        job_status: 'running',
        job_error: null,
        rows,
      }),
    }),
  )
  await page.goto(`/imports/${id}`)
  const progress = page.getByRole('region', { name: '本批处理进度' })
  await expect(progress.getByText('属性识别').locator('..')).toContainText('1 / 2 已完成')
  await page.screenshot({ path: info.outputPath('processing-review.png'), fullPage: true })
  await page.getByRole('button', { name: '需处理', exact: true }).click()
  await page.getByRole('button', { name: '修改属性', exact: true }).click()
  await expect(page.getByRole('heading', { name: '先处理 1 个字段' })).toBeVisible()
  await page.getByRole('button', { name: '重置购入金额（元）' }).click()
  await page.getByRole('button', { name: '获得与收纳', exact: true }).click()
  await expect(page.getByRole('heading', { name: '获得与收纳资料' })).toBeFocused()
  await page.getByLabel('购入金额（元）').fill('-1')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByLabel('购入金额（元）')).toBeFocused()
  const field = (await page.getByLabel('购入金额（元）').boundingBox())!
  const footer = (await page.locator('.sheet-footer').boundingBox())!
  expect(field.y + field.height).toBeLessThanOrEqual(footer.y)
  await page.screenshot({ path: info.outputPath('editor-error.png') })
})

test('多件确认始终可见提交栏，核对信息和提醒完整', async ({ page }, info) => {
  if (info.project.name === 'mobile-chromium')
    await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const rows = Array.from({ length: 20 }, (_, n) => row(n + 1))
  await page.route(`**/api/v1/imports/${id}`, (route) =>
    route.fulfill({
      json: envelope({
        id,
        source: 'photos',
        parent_job_id: id,
        job_status: 'succeeded',
        job_error: null,
        rows,
      }),
    }),
  )
  await page.goto(`/imports/${id}`)
  await page.getByRole('button', { name: '选择本页待确认' }).click()
  await page.getByRole('button', { name: '确认选中（20）' }).click()
  const dialog = page.getByRole('dialog', { name: '确认将 20 件加入衣橱？' })
  await expect(dialog.getByText('上装 · 可穿').first()).toBeVisible()
  await expect(dialog.getByText('子类：衬衫').first()).toBeVisible()
  await dialog.getByText('识别提醒 · 1 项').first().click()
  await expect(dialog.getByText('袖口细节请按实物核对').first()).toBeVisible()
  const button = dialog.getByRole('button', { name: '确认入库', exact: true })
  for (const size of [
    { width: 375, height: 667 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    await expect(button).toBeInViewport()
    const bounds = (await button.boundingBox())!
    expect(bounds.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('confirm-landscape.png') })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.screenshot({ path: info.outputPath('confirm-portrait.png') })
  await dialog.getByRole('button', { name: '继续核对' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '确认选中（20）' })).toBeEnabled()
})
