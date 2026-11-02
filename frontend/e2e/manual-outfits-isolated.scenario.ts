import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

async function seed(request: APIRequestContext) {
  const name = `手动验收-${randomUUID().slice(0, 8)}`
  const response = await request.post('/api/v1/imports/photos', {
    headers: { 'Idempotency-Key': randomUUID() },
    multipart: {
      files: {
        name: 'manual.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  const batch = (await response.json()).data.import_batch_id
  await expect
    .poll(
      async () => (await (await request.get(`/api/v1/imports/${batch}`)).json()).data.job_status,
      { timeout: 60000 },
    )
    .toBe('succeeded')
  const row = (await (await request.get(`/api/v1/imports/${batch}`)).json()).data.rows[0]
  const confirmed = await request.post(`/api/v1/imports/${batch}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { rows: [{ row_id: row.id, expected_version: row.version }] },
  })
  const id = (await confirmed.json()).data.rows[0].garment_id
  expect(id).toBeTruthy()
  const item = (await (await request.get(`/api/v1/garments/${id}`)).json()).data
  expect(
    (
      await request.patch(`/api/v1/garments/${id}`, {
        data: { expected_version: item.version, changes: { name } },
      })
    ).ok(),
  ).toBeTruthy()
  return { id, name }
}
async function select(page: Page, name: string) {
  await page.getByRole('button', { name: '选择衣服', exact: true }).click()
  await page.getByLabel('搜索衣服名称').fill(name)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: `选择：${name}`, exact: true }).click()
  await page.getByRole('button', { name: '完成选择（1 件）' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('P7.1: manual save, immutable edit, favorite and explicit reuse without AI', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.P7_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  const { id, name } = await seed(request)
  const errors: string[] = []
  const models: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (/\/(generate|adjust|diagnostics)$/.test(r.url())) models.push(r.url())
  })
  const current = (await (await request.get('/api/v1/outfit-sessions/current')).json()).data
  await page.goto('/wardrobe')
  await page.getByRole('link', { name: '手动搭配', exact: true }).click()
  await select(page, name)
  await page.reload()
  await expect(page.getByRole('button', { name: `移除：${name}` })).toBeVisible()
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/manual-outfits') && r.status() === 201,
  )
  await page.getByRole('button', { name: '保存手动搭配', exact: true }).click()
  const revision = (await (await saved).json()).data.revision
  await expect(page.getByText('手动搭配已保存', { exact: true })).toBeVisible()
  expect((await (await request.get('/api/v1/outfit-sessions/current')).json()).data).toEqual(
    current,
  )
  const image = revision.items[0].image_url
  const pixels = await (await request.get(image)).body()
  await page.getByRole('link', { name: '查看保存的搭配' }).click()
  await expect(
    page.locator('.record-detail-heading').getByText('手动搭配', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '收藏这套', exact: true }).click()
  await page.getByLabel('收藏名称（选填）').fill(name)
  await page.getByRole('button', { name: '确认收藏', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: '修改为新搭配' }).click()
  await expect(page.getByRole('button', { name: '保存手动搭配', exact: true })).toBeEnabled()
  const edited = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/manual-outfits') && r.status() === 201,
  )
  await page.getByRole('button', { name: '保存手动搭配', exact: true }).click()
  const next = (await (await edited).json()).data.revision
  expect(next.parent_revision_id).toBe(revision.id)
  expect(next.id).not.toBe(revision.id)
  expect(
    (await (await request.get(`/api/v1/outfit-revisions/${revision.id}`)).json()).data,
  ).toEqual(revision)
  await page.getByRole('link', { name: '查看保存的搭配' }).click()
  await page.getByRole('button', { name: '以这套为基础搭配', exact: true }).click()
  // Reproduce slow asynchronous history cleanup; it must finish before route navigation.
  await page.evaluate(() => {
    const back = history.back.bind(history)
    history.back = () => {
      window.setTimeout(back, 150)
    }
  })
  await page.getByRole('button', { name: '继续搭配', exact: true }).click()
  await expect(page).toHaveURL(/\/outfits\//)
  await expect.poll(() => page.evaluate(() => !!history.state?.__wardrobeSheet)).toBe(false)
  await expect(page.getByText('手动搭配', { exact: true })).toBeVisible()
  const garment = (await (await request.get(`/api/v1/garments/${id}`)).json()).data
  expect(
    (
      await request.delete(`/api/v1/garments/${id}`, {
        headers: { 'If-Match': String(garment.version) },
      })
    ).status(),
  ).toBe(204)
  expect(await (await request.get(image)).body()).toEqual(pixels)
  expect(models).toEqual([])
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('manual-reused.png'), fullPage: true })
})

test('P7.1: confirmed unavailable wear, lost response replay, calendar edit and delete', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.P7_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  const { id, name } = await seed(request)
  const g = (await (await request.get(`/api/v1/garments/${id}`)).json()).data
  await request.patch(`/api/v1/garments/${id}`, {
    data: { expected_version: g.version, changes: { availability: 'unavailable' } },
  })
  const attempts: { key: string | undefined; body: unknown }[] = []
  let stored: { revision: { id: string }; wear: { id: string; worn_on: string } } | undefined
  await page.route('**/api/v1/manual-outfits', async (route) => {
    attempts.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    })
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    const result = (await response.json()).data
    if (!stored) {
      stored = result
      await route.abort('failed')
    } else {
      expect(result).toEqual(stored)
      await route.fulfill({ response })
    }
  })
  await page.goto('/collections/manual')
  await select(page, name)
  await expect(page.getByRole('button', { name: '保存手动搭配', exact: true })).toBeDisabled()
  await page.getByLabel('直接记录实际穿着', { exact: true }).check()
  await page.getByLabel('穿着备注（选填）').fill('真实穿过，现在待洗')
  await expect(page.getByRole('button', { name: '确认记录穿着', exact: true })).toBeDisabled()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '确认记录穿着', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '重发同一操作' })).toBeVisible()
  expect(attempts).toHaveLength(1)
  await page.getByRole('button', { name: '重发同一操作' }).click()
  await expect(page.getByText('穿着已记录', { exact: true })).toBeVisible()
  expect(attempts).toHaveLength(2)
  expect(attempts[1]).toEqual(attempts[0])
  expect((await (await request.get(`/api/v1/garments/${id}`)).json()).data.availability).toBe(
    'unavailable',
  )
  expect(
    (await (await request.get(`/api/v1/garments/${id}/lifecycle`)).json()).data.wear_days,
  ).toBe(1)
  await page.getByRole('link', { name: '查看穿着日历' }).click()
  const card = page.locator('.record-card').filter({ hasText: name })
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: '编辑记录' }).click()
  const previous = new Date(`${stored!.wear.worn_on}T12:00:00Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  const previousDay = previous.toISOString().slice(0, 10)
  await page.getByLabel('实际穿着日期').fill(previousDay)
  await page.getByLabel('穿着备注（选填）').fill('补充备注')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto(`/collections?view=calendar&month=${previousDay.slice(0, 7)}&date=${previousDay}`)
  await expect(card.getByText('补充备注', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('manual-calendar.png'), fullPage: true })
  await card.getByRole('button', { name: '更多搭配操作' }).click()
  await page.getByRole('button', { name: '删除穿着记录', exact: true }).click()
  await page.getByRole('button', { name: '确认删除穿着记录', exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(
    (await (await request.get(`/api/v1/outfit-revisions/${stored!.revision.id}`)).json()).data
      .source,
  ).toBe('manual')
  expect(
    (await (await request.get(`/api/v1/garments/${id}/lifecycle`)).json()).data.wear_days,
  ).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
