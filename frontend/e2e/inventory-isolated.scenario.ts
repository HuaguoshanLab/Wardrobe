import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('W2: edit, estimate, copy, subtype impact and live garment counts', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.P6_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const suffix = `${info.project.name}-${Date.now()}`
  const name = `日常轮换-${suffix}`
  const subtypeName = `短袖-${suffix}`
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  const upload = await request.post('/api/v1/imports/photos', {
    headers: key(),
    multipart: {
      files: {
        name: 'w2.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const batch = (await upload.json()).data.import_batch_id
  let row: { id: string; version: number; row_status: string }
  await expect
    .poll(
      async () => {
        const batchState = (await (await request.get(`/api/v1/imports/${batch}`)).json()).data
        row = batchState.rows[0]
        return batchState.job_status === 'succeeded' ? row.row_status : batchState.job_status
      },
      { timeout: 60000 },
    )
    .toBe('ready')
  const confirmation = await request.post(`/api/v1/imports/${batch}/confirm`, {
    headers: key(),
    data: { rows: [{ row_id: row!.id, expected_version: row!.version }] },
  })
  const id = (await confirmation.json()).data.rows[0].garment_id
  const garmentPath = `/api/v1/garments/${id}`
  let garment = (await (await request.get(garmentPath)).json()).data
  const changed = await request.patch(garmentPath, {
    headers: key(),
    data: {
      expected_version: garment.version,
      changes: { name, category: 'top', seasons: ['spring', 'summer'] },
    },
  })
  expect(changed.ok()).toBeTruthy()
  // Prepare fresh seasonal configs only in the guarded isolated environment.
  for (const season of ['spring', 'summer']) {
    const plan = (await (await request.get(`/api/v1/inventory/${season}`)).json()).data.plan
    expect(
      (
        await request.post(`/api/v1/inventory/${season}`, {
          headers: key(),
          data: { expected_version: plan.version, city: '', period: '', notes: '', rows: [] },
        })
      ).ok(),
    ).toBeTruthy()
  }
  let writes = 0
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/v1/')) writes++
  })
  await page.goto('/wardrobe/inventory?season=spring')
  await expect(page.getByRole('heading', { name: '先写下这一季的需要' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: '编辑本季目标' })).toBeVisible()
  expect(writes).toBe(0)
  await page.getByRole('link', { name: '管理子类', exact: true }).click()
  await page.getByRole('button', { name: '新增子类', exact: true }).click()
  await page.getByLabel('子类名称', { exact: true }).fill(subtypeName)
  await page.getByRole('button', { name: '创建子类', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const subtype = (await (await request.get('/api/v1/garment-subtypes')).json()).data.find(
    (s: { name: string }) => s.name === subtypeName,
  )
  garment = (await (await request.get(garmentPath)).json()).data
  expect(
    (
      await request.post(`${garmentPath}/lifecycle`, {
        headers: key(),
        data: {
          expected_version: garment.version,
          action: 'profile',
          occurred_on: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
          changes: { subtype_id: subtype.id },
        },
      })
    ).ok(),
  ).toBeTruthy()
  await page.getByRole('link', { name: '返回盘点', exact: true }).click()
  await page.getByRole('link', { name: '编辑本季目标', exact: true }).click()
  await page.getByRole('button', { name: '新增需求', exact: true }).click()
  await page.getByLabel('需求名称', { exact: true }).fill(name)
  await page.getByText('细化匹配规则 · 选填', { exact: true }).click()
  await page.getByRole('button', { name: subtypeName, exact: true }).click()
  await page.getByText('不确定件数？估算日常轮换', { exact: true }).click()
  await page.getByRole('button', { name: '计算参考下限', exact: true }).click()
  await expect(page.getByText('参考下限 5 件', { exact: true })).toBeVisible()
  await expect(page.getByLabel('目标下限', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '采用此下限到草稿', exact: true }).click()
  await expect(page.getByLabel('目标下限', { exact: true })).toHaveValue('5')
  await page.getByLabel('目标上限', { exact: true }).fill('7')
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('inventory-estimate.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: '应用到本季草稿', exact: true }).click()
  expect(
    (await (await request.get('/api/v1/inventory/spring')).json()).data.plan.rows,
  ).toHaveLength(0)
  await page.getByRole('button', { name: '保存本季目标', exact: true }).click()
  await expect(page).toHaveURL(/inventory\?season=spring$/)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看单品明细', exact: true }).click()
  const before = (await (await request.get('/api/v1/inventory/spring')).json()).data.counts[0]
  expect(before.matched_owned).toBe(1)
  expect(before.pending).toBeGreaterThanOrEqual(1)
  await expect(
    page.getByRole('button', { name: `待核对 ${before.pending}`, exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: new RegExp(name) }).click()
  await page.getByRole('link', { name: '生命周期 · 获得、收纳与整理', exact: true }).click()
  await page.getByRole('button', { name: /^状况与合身：/ }).click()
  await page.getByLabel('衣物状况', { exact: true }).selectOption('good')
  await page.getByLabel('合身情况', { exact: true }).selectOption('fits')
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: '返回单品', exact: true }).click()
  await page.getByRole('link', { name: '返回盘点', exact: true }).click()
  const spring = (await (await request.get('/api/v1/inventory/spring')).json()).data
  expect(spring.counts[0].confirmed).toBe(1)
  expect(spring.counts[0].pending).toBe(before.pending - 1)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await page.getByRole('button', { name: '夏 季', exact: true }).click()
  await page.getByRole('link', { name: '编辑本季目标', exact: true }).click()
  await page.getByText('复制其他季节的需求', { exact: true }).click()
  await page.getByRole('combobox', { name: '复制来源', exact: true }).selectOption('spring')
  await page.getByRole('button', { name: '追加到本季草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存本季目标', exact: true }).click()
  await expect(page).toHaveURL(/inventory\?season=summer$/)
  await expect(page.getByText('1 件同时覆盖其他需求，查看明细了解共享情况。')).toBeVisible()
  const summer = (await (await request.get('/api/v1/inventory/summer')).json()).data
  expect(summer.plan.rows[0].id).not.toBe(spring.plan.rows[0].id)
  await page.getByRole('link', { name: '管理子类', exact: true }).click()
  await page.getByRole('button', { name: `管理${subtypeName}`, exact: true }).click()
  await expect(page.getByText('1 件当前持有衣服，1 份单品档案，2 条需求。')).toBeVisible()
  await page.getByLabel('子类名称', { exact: true }).fill(`${subtypeName}-改`)
  await page.getByLabel('允许新的归类和需求引用', { exact: true }).uncheck()
  await page.getByRole('button', { name: '确认影响并保存', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: '返回盘点', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  for (const viewport of [
    { width: 320, height: 680 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('inventory.png'),
    fullPage: true,
  })
  const beforeReload = writes
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  expect(writes).toBe(beforeReload)
  expect(errors).toEqual([])
})
