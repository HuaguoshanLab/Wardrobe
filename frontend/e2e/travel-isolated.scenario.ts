import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('travel: draft recovery, lost response, multi-day generation, packing, fixed days and actual wear', async ({
  page,
  request,
}, info) => {
  const headers = () => ({ 'Idempotency-Key': randomUUID() })
  const get = async (path: string) => (await (await request.get(`/api/v1${path}`)).json()).data
  for (const category of ['top', 'bottom', 'shoes']) {
    const upload = await request.post('/api/v1/imports/photos', {
      headers: headers(),
      multipart: {
        files: {
          name: 'travel.png',
          mimeType: 'image/png',
          buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
        },
      },
    })
    expect(upload.ok()).toBeTruthy()
    const bid = (await upload.json()).data.import_batch_id
    await expect
      .poll(async () => (await get(`/imports/${bid}`)).job_status, { timeout: 90000 })
      .toBe('succeeded')
    const row = (await get(`/imports/${bid}`)).rows[0]
    const edited = await request.patch(`/api/v1/imports/${bid}/rows/${row.id}`, {
      data: {
        expected_version: row.version,
        changes: { category, subtype_name: null, name: `旅行-${category}` },
      },
    })
    expect(edited.ok(), await edited.text()).toBeTruthy()
    const updated = (await edited.json()).data
    const confirmation = await request.post(`/api/v1/imports/${bid}/confirm`, {
      headers: headers(),
      data: { rows: [{ row_id: row.id, expected_version: updated.version }] },
    })
    expect(confirmation.ok(), await confirmation.text()).toBeTruthy()
  }
  const name = `旅行验收-${randomUUID().slice(0, 8)}`
  let generations = 0
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/generate')) generations++
  })
  await page.goto('/collections')
  await page.getByRole('link', { name: '旅行胶囊衣橱', exact: true }).click()
  await page.getByRole('button', { name: '新建旅行计划' }).click()
  await page.getByLabel('行程名称').fill(name)
  await page.getByText('手动填写目的地', { exact: true }).click()
  await page.getByLabel('城市', { exact: true }).fill('深圳')
  await page.getByLabel('补充要求').fill('少带一些')
  await page.reload()
  await page.getByRole('button', { name: '新建旅行计划' }).click()
  await expect(page.getByLabel('行程名称')).toHaveValue(name)
  await expect(page.getByLabel('补充要求')).toHaveValue('少带一些')
  let lost = true
  const writes: { key: string; body: string | null }[] = []
  await page.route('**/api/v1/travel-plans', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    writes.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postData(),
    })
    const response = await route.fetch()
    if (lost) {
      lost = false
      return route.abort('failed')
    }
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: '保存行程', exact: true }).click()
  await expect(page.getByRole('button', { name: '重发原操作' })).toBeVisible()
  await page.reload()
  expect(generations).toBe(0)
  await page.getByRole('button', { name: '重发原操作' }).click()
  await expect(page.getByRole('button', { name: '生成旅行计划', exact: true })).toBeVisible()
  expect(writes[1]).toEqual(writes[0])
  const planId = page.url().split('/').at(-1)!
  const beforeWear = await get('/wear-records')
  await page.getByRole('button', { name: '生成旅行计划', exact: true }).click()
  await expect(page.getByRole('heading', { name: /第 1 版 · 3 天/ })).toBeVisible({
    timeout: 30000,
  })
  expect(generations).toBe(1)
  const first = await get(`/travel-plans/${planId}`)
  expect(first.revision.days).toHaveLength(3)
  expect(await get('/wear-records')).toEqual(beforeWear)
  const packing = page.locator('.travel-packing input[type="checkbox"]').first()
  await packing.check()
  await expect(packing).toBeChecked()
  await expect(page.getByRole('button', { name: '编辑行程', exact: true })).toBeEnabled()
  await page.reload()
  await expect(packing).toBeChecked()
  expect(generations).toBe(1)
  await page.getByRole('button', { name: '调整这一天', exact: true }).first().click()
  await page.getByLabel('这一天的调整要求').fill('保持轻便')
  await page.getByRole('button', { name: '确认调整这一天' }).click()
  await expect(page.getByRole('heading', { name: /第 2 版 · 3 天/ })).toBeVisible({
    timeout: 30000,
  })
  const second = await get(`/travel-plans/${planId}`)
  expect(second.revision.days.slice(1)).toEqual(first.revision.days.slice(1))
  await expect(packing).toBeChecked()
  await page.getByRole('button', { name: '确认这天穿过', exact: true }).first().click()
  await page.getByRole('button', { name: '确认并记录穿着' }).click()
  await expect(page.getByText('已记录到穿着日历。')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(generations).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: info.outputPath('travel-complete.png'), fullPage: true })
  await page.getByRole('button', { name: '删除计划', exact: true }).click()
  await page.getByRole('button', { name: '确认删除计划', exact: true }).click()
  await expect(page).toHaveURL(/\/collections\/travel$/)
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
  expect((await request.get(`/api/v1/travel-plans/${planId}`)).status()).toBe(404)
  expect(generations).toBe(2)
  expect(errors).toEqual([])
})
