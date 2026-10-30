import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

test('导入资料：审核、保留草稿、入库、生命周期和盘点', async ({ page, request }, info) => {
  if (info.project.name === 'mobile-chromium')
    await page.setViewportSize({ width: 320, height: 568 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const upload = await request.post('/api/v1/imports/photos', {
    headers: { 'Idempotency-Key': randomUUID() },
    multipart: {
      files: {
        name: 'import-details.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const batchId = (await upload.json()).data.import_batch_id
  const batch = async () => (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data
  await expect.poll(async () => (await batch()).job_status, { timeout: 60000 }).toBe('succeeded')
  const initial = (await batch()).rows[0]
  expect(initial.draft.subtype_name).toBeTruthy()
  expect(initial.draft.condition).toBe('unknown')
  expect(initial.draft.fit).toBe('unknown')
  expect(initial.draft.price).toBeNull()
  let calls = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && /photos|retry/.test(r.url())) calls++
  })
  await page.goto(`/imports/${batchId}`)
  await page.getByRole('button', { name: '修改属性', exact: true }).click()
  const subtype = `导入-${info.project.name}-${Date.now()}`
  await page.getByLabel('子类', { exact: true }).fill(subtype)
  await page.getByLabel('衣物状况', { exact: true }).selectOption('good')
  await page.getByLabel('合身情况', { exact: true }).selectOption('fits')
  await page.getByLabel('获得来源', { exact: true }).selectOption('gift')
  await page.getByLabel('获得日期', { exact: true }).fill('2025-06-01')
  await page.getByLabel('购入金额（元）', { exact: true }).fill('-1')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '金额' })).toBeVisible()
  await page.getByLabel('购入金额（元）', { exact: true }).fill('0.00')
  await page.getByLabel('收纳状态', { exact: true }).selectOption('stored')
  await page.getByLabel('收纳位置', { exact: true }).fill('衣柜第二层')
  await page.getByLabel('档案备注', { exact: true }).fill('人工核对资料')
  await page.getByRole('button', { name: '春', exact: true }).click()
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('子类', { exact: true })).toHaveValue(subtype)
  await expect(page.getByLabel('购入金额（元）', { exact: true })).toHaveValue('0.00')
  await page.getByLabel('子类', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('initial-facts-editor.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '修改属性', exact: true }).click()
  await expect(page.getByLabel('收纳位置', { exact: true })).toHaveValue('衣柜第二层')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.getByRole('button', { name: '核对入库', exact: true }).click()
  await page.getByRole('button', { name: '确认入库', exact: true }).click()
  await expect.poll(async () => (await batch()).rows[0].row_status).toBe('confirmed')
  const gid = (await batch()).rows[0].confirmed_garment_id
  const garment = (await (await request.get(`/api/v1/garments/${gid}`)).json()).data
  expect(garment.lifecycle).toMatchObject({
    condition: 'good',
    fit: 'fits',
    price: '0.00',
    source: 'gift',
    storage: 'stored',
    location: '衣柜第二层',
  })
  expect(garment.availability).toBe('available')
  await page.goto(`/wardrobe/${gid}/lifecycle`)
  await expect(page.getByText('¥0.00', { exact: true })).toBeVisible()
  await expect(page.getByText('人工核对资料', { exact: true })).toBeVisible()
  // A dedicated subtype keeps sequential desktop/mobile runs independent.
  const current = (await (await request.get('/api/v1/inventory/spring')).json()).data
  const demandId = randomUUID()
  const inventory = await request.post('/api/v1/inventory/spring', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      expected_version: current.plan.version,
      rows: [
        ...current.plan.rows,
        {
          id: demandId,
          name: subtype,
          category: 'top',
          subtype_ids: [garment.subtype_id],
          lower: 1,
          upper: 2,
        },
      ],
    },
  })
  expect(inventory.ok()).toBeTruthy()
  const result = (await (await request.get('/api/v1/inventory/spring')).json()).data
  expect(result.counts.find((row: { row_id: string }) => row.row_id === demandId)).toMatchObject({
    confirmed: 1,
    pending: 0,
  })
  await page.goto(`/wardrobe/inventory?season=spring&focus=${demandId}&group=confirmed`)
  await expect(page.getByRole('dialog', { name: `${subtype} · 单品明细` })).toBeVisible()
  await expect(page.getByRole('button', { name: '已确认 1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '待核对 0', exact: true })).toBeVisible()
  expect(calls).toBe(0)
  expect(errors).toEqual([])
})
