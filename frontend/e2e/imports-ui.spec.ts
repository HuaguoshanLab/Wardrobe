import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const batchId = '00000000-0000-4000-8000-000000000091'
const id1 = '00000000-0000-4000-8000-000000000092'
const id2 = '00000000-0000-4000-8000-000000000093'
const envelope = (data: unknown) => ({ data, request_id: batchId })
const attributes = {
  name: '白色衬衫',
  category: 'top',
  color_codes: [],
  seasons: [],
  occasion_codes: [],
  style_codes: [],
  material: null,
  thickness: null,
  warmth: null,
  custom_tag_ids: [],
  availability: 'available',
  display_variant: 'original',
}
const row = (id: string, number: number) => ({
  id,
  row_number: number,
  filename: `shirt-${number}.png`,
  image_asset_id: id,
  image_url: '/test-shirt.png',
  has_cutout: false,
  draft: { ...attributes },
  version: 1,
  touched_fields: [],
  validation_errors: [],
  processing_errors: {},
  row_status: 'ready',
  conversion_status: 'succeeded',
  analysis_status: 'succeeded',
  cutout_status: 'not_requested',
  analysis_notes: [],
  analysis_source: 'fake',
  confirmed_garment_id: null,
})
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort('blockedbyclient'),
  )
  await page.route('**/test-shirt.png', async (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
    }),
  )
})

test('photo previews append, remove and protect switching; upload stays explicit', async ({
  page,
}, info) => {
  const posts: string[] = []
  await page.route('**/api/v1/imports/photos', (route) => {
    posts.push(route.request().headers()['idempotency-key'])
    return route.fulfill({
      json: envelope({ import_batch_id: batchId, job_id: batchId, status: 'queued' }),
    })
  })
  await page.route(`**/api/v1/imports/${batchId}`, (route) =>
    route.fulfill({
      json: envelope({
        id: batchId,
        source: 'photos',
        parent_job_id: batchId,
        job_status: 'succeeded',
        job_error: null,
        rows: [row(id1, 1)],
      }),
    }),
  )
  await page.goto('/imports')
  const bytes = await readFile(new URL('./fixtures/shirt.png', import.meta.url))
  await page
    .getByLabel('上传照片')
    .setInputFiles({ name: 'shirt.png', mimeType: 'image/png', buffer: bytes })
  await page
    .getByLabel('上传照片')
    .setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: bytes })
  await expect(page.locator('.import-file')).toHaveCount(2)
  await page.getByRole('button', { name: '移除 second.png' }).click()
  await expect(page.locator('.import-file')).toHaveCount(1)
  await page.getByRole('button', { name: /导入 Excel/ }).click()
  await expect(page.getByRole('dialog', { name: '切换录入方式？' })).toBeVisible()
  await page.getByRole('button', { name: '保留当前选择' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(posts).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('photos-selected.png'), fullPage: true })
  await page.getByRole('button', { name: '上传并识别照片' }).click()
  await expect(page.getByRole('heading', { name: '审核衣服', exact: true })).toBeVisible()
  expect(posts).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: '审核衣服', exact: true })).toBeVisible()
  expect(posts).toHaveLength(1)
})

test('failed confirmation restores exact objects after refresh and locks new selection', async ({
  page,
}, info) => {
  let rows = [row(id1, 1), row(id2, 2)]
  const requests: { body: string | null; key: string | undefined }[] = []
  await page.route(`**/api/v1/imports/${batchId}`, (route) =>
    route.fulfill({
      json: envelope({
        id: batchId,
        source: 'photos',
        parent_job_id: batchId,
        job_status: 'succeeded',
        job_error: null,
        rows,
      }),
    }),
  )
  await page.route(`**/api/v1/imports/${batchId}/confirm`, (route) => {
    requests.push({
      body: route.request().postData(),
      key: route.request().headers()['idempotency-key'],
    })
    if (requests.length === 1) {
      rows = rows.map((item) => ({ ...item, version: 2 }))
      return route.abort('failed')
    }
    rows = rows.map((item) => (item.id === id1 ? { ...item, row_status: 'confirmed' } : item))
    return route.fulfill({
      json: envelope({ rows: [{ row_id: id1, status: 'confirmed', garment_id: id1, errors: [] }] }),
    })
  })
  await page.goto(`/imports/${batchId}`)
  await page.getByLabel('选择第 1 行').check()
  await page.getByRole('button', { name: '确认选中（1）' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(requests).toHaveLength(0)
  await page.screenshot({ path: info.outputPath('confirm-mocked.png') })
  await page.getByRole('button', { name: '确认入库', exact: true }).click()
  await expect(page.getByRole('button', { name: '重试上次确认' })).toBeVisible()
  await expect(page.getByLabel('选择第 2 行')).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: '重试上次确认' })).toBeVisible()
  await expect(page.getByLabel('选择第 2 行')).toBeDisabled()
  expect(requests).toHaveLength(1)
  await page.getByRole('button', { name: '重试上次确认' }).click()
  await expect(page.getByText('本次确认：1 件已入库。')).toBeVisible()
  expect(requests[0]).toEqual(requests[1])
  expect(JSON.parse(requests[1].body!).rows).toEqual([{ row_id: id1, expected_version: 1 }])
  await expect(page.getByLabel('选择第 2 行')).toBeEnabled()
})

test('review isolates source errors and protects editor drafts; actions require confirmation', async ({
  page,
}, info) => {
  const rows = [
    row(id1, 1),
    {
      ...row(id2, 2),
      image_asset_id: null,
      image_url: null,
      row_status: 'invalid',
      conversion_status: 'failed',
      processing_errors: { conversion: '图片跨行，请修正 Excel' },
      validation_errors: ['图片必填'],
    },
  ]
  let writes = 0
  await page.route(`**/api/v1/imports/${batchId}`, (route) =>
    route.fulfill({
      json: envelope({
        id: batchId,
        source: 'excel',
        parent_job_id: batchId,
        job_status: 'succeeded',
        job_error: null,
        rows,
      }),
    }),
  )
  await page.route(`**/api/v1/imports/${batchId}/rows/*`, (route) => {
    writes++
    return route.fulfill({ json: envelope({ ...rows[0], row_status: 'skipped' }) })
  })
  await page.goto(`/imports/${batchId}`)
  await expect(page.locator('.import-overview')).toContainText('需处理')
  await page.screenshot({ path: info.outputPath('review-mocked.png'), fullPage: true })
  await page.getByRole('button', { name: '需处理', exact: true }).click()
  await page.getByText('更多操作', { exact: true }).click()
  await expect(page.getByRole('button', { name: '重试转换' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '修正文件后重新上传' })).toBeVisible()
  await page.getByRole('button', { name: '全部', exact: true }).click()
  await page.getByRole('button', { name: '修改属性' }).first().click()
  await page.getByLabel('名称', { exact: true }).fill('未保存的名称')
  const inputBounds = await page.getByLabel('名称', { exact: true }).boundingBox()
  const footerBounds = await page
    .locator('.sheet-footer')
    .filter({ has: page.getByRole('button', { name: '保存修改' }) })
    .boundingBox()
  expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(footerBounds!.y)
  await page.screenshot({ path: info.outputPath('editor-mocked.png') })
  await page.getByRole('button', { name: '关闭面板' }).click()
  const discard = page.getByRole('dialog', { name: '放弃未保存的修改？' })
  await expect(discard).toBeVisible()
  await discard.getByRole('button', { name: '继续编辑' }).click()
  await expect(discard).toHaveCount(0)
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('未保存的名称')
  await page.getByRole('button', { name: '取消编辑' }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes).toBe(0)
  await page.getByText('更多操作', { exact: true }).first().click()
  await page.getByRole('button', { name: '移除此行' }).first().click()
  await expect(page.getByRole('dialog', { name: '移除此行？' })).toBeVisible()
  expect(writes).toBe(0)
  await page.getByRole('button', { name: '暂不操作' }).click()
})

test('real entry and Excel guide fit narrow screens without uploading', async ({ page }, info) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/imports')
  await page.getByRole('button', { name: /导入 Excel/ }).click()
  await page.getByText('如何填写模板和放置图片？').click()
  await expect(page.getByRole('link', { name: /下载 Excel 模板/ })).toBeVisible()
  await page.screenshot({ path: info.outputPath('excel.png'), fullPage: true })
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
  }
  expect(writes).toEqual([])
})
