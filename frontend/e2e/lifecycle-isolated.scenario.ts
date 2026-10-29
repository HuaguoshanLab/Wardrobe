import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

test('W1: lifecycle, archive, restore and immutable events', async ({ page, request }, info) => {
  test.skip(process.env.P6_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const upload = await request.post('/api/v1/imports/photos', {
    headers: { 'Idempotency-Key': randomUUID() },
    multipart: {
      files: {
        name: 'w1.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const batchId = (await upload.json()).data.import_batch_id
  let row: { id: string; version: number; row_status: string }
  await expect
    .poll(
      async () => {
        const result = await request.get(`/api/v1/imports/${batchId}`)
        const batchState = (await result.json()).data
        row = batchState.rows[0]
        return batchState.job_status === 'succeeded' ? row.row_status : batchState.job_status
      },
      { timeout: 60000 },
    )
    .toBe('ready')
  const confirmed = await request.post(`/api/v1/imports/${batchId}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { rows: [{ row_id: row!.id, expected_version: row!.version }] },
  })
  expect(confirmed.ok()).toBeTruthy()
  const id = (await confirmed.json()).data.rows[0].garment_id
  const path = `/api/v1/garments/${id}`
  let writes = 0
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/v1/')) writes++
  })
  await page.goto(`/wardrobe/${id}`)
  await page.getByRole('link', { name: '生命周期 · 获得、收纳与整理' }).click()
  await expect(page.getByText('暂无穿着记录', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '补充获得资料', exact: true })).toBeVisible()
  expect(writes).toBe(0)
  await page.getByRole('button', { name: '补充获得资料', exact: true }).click()
  await page.getByLabel('购入金额（元）').fill('39.90')
  await page.getByRole('button', { name: '新增子类', exact: true }).click()
  const subtypeName = `衬衫-${info.project.name}-${Date.now()}`
  await page.getByLabel('子类名称').fill(subtypeName)
  await page.getByRole('button', { name: '创建子类', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByLabel('购入金额（元）')).toHaveValue('39.90')
  await expect(page.getByLabel('子类', { exact: true }).locator('option:checked')).toHaveText(
    subtypeName,
  )
  await page.getByRole('textbox', { name: '收纳位置', exact: true }).fill('衣柜二层')
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('¥39.90', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^可穿状态：/ }).click()
  await page.getByRole('radio', { name: '暂不可用', exact: true }).check()
  await page.getByLabel('暂不可用原因').selectOption('washing')
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /^收纳位置：/ }).click()
  await page.getByRole('radio', { name: '换季收纳', exact: true }).check()
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  let item = (await (await request.get(path)).json()).data
  expect(item.availability).toBe('unavailable')
  expect(item.lifecycle.unavailable_reason).toBe('washing')
  await page.getByRole('button', { name: /^整理决定：/ }).click()
  await page.getByRole('radio', { name: '继续保留', exact: true }).check()
  await page.getByLabel('决定原因').fill('留作备用')
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /^整理决定：/ }).click()
  await page.getByLabel('决定原因').fill('')
  await page.getByRole('radio', { name: '未决定', exact: true }).check()
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await (await request.get(path)).json()).data.lifecycle.decision_reason).toBe('')
  const oldImage = await (await request.get(item.image_url)).body()
  await page.getByRole('button', { name: '退出衣橱', exact: true }).click()
  await page.getByLabel('退出去向').selectOption('gifted')
  await page.getByLabel('已核对全部季节影响，确认实际退出').check()
  await page.getByRole('button', { name: '确认退出衣橱' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '撤销退出', exact: true })).toBeEnabled()
  expect(
    (await (await request.get('/api/v1/garments')).json()).data.items.some(
      (g: { id: string }) => g.id === id,
    ),
  ).toBe(false)
  await page.goto('/wardrobe?ownership=retired')
  await expect(page.locator(`a[href="/wardrobe/${id}"]`)).toBeVisible()
  await page.locator(`a[href="/wardrobe/${id}"]`).click()
  await page.getByRole('link', { name: '生命周期 · 获得、收纳与整理' }).click()
  await page.getByRole('button', { name: '撤销退出', exact: true }).click()
  await page.getByLabel('本次说明').fill('误操作')
  await page.getByRole('button', { name: '确认撤销退出' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  item = (await (await request.get(path)).json()).data
  expect(item.ownership).toBe('owned')
  expect(item.lifecycle.unavailable_reason).toBe('washing')
  expect(await (await request.get(item.image_url)).body()).toEqual(oldImage)
  await page.getByText('详情与更正', { exact: true }).first().click()
  await page.getByRole('button', { name: '更正这条记录' }).first().click()
  await page.getByLabel('更正说明').fill('补充说明：仍在待洗')
  await page.getByRole('button', { name: '保存记录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('补充说明：仍在待洗', { exact: true })).toBeVisible()
  const beforeReload = writes
  await page.reload()
  await expect(page.getByText('补充说明：仍在待洗', { exact: true })).toBeVisible()
  expect(writes).toBe(beforeReload)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('lifecycle.png'), fullPage: true })
  expect(errors).toEqual([])
})
