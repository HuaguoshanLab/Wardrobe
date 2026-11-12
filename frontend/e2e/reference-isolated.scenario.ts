import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('reference: explicit analyze, editable clues, lost response, reload, generation and deletion', async ({
  page,
  request,
}, info) => {
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  const get = async (path: string) => (await (await request.get('/api/v1' + path)).json()).data
  for (const category of ['top', 'bottom', 'shoes']) {
    const upload = await request.post('/api/v1/imports/photos', {
      headers: key(),
      multipart: {
        files: {
          name: 'ref-test.png',
          mimeType: 'image/png',
          buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
        },
      },
    })
    const bid = (await upload.json()).data.import_batch_id
    await expect
      .poll(async () => (await get(`/imports/${bid}`)).job_status, { timeout: 90000 })
      .toBe('succeeded')
    let item = (await get(`/imports/${bid}`)).rows[0]
    const edited = await request.patch(`/api/v1/imports/${bid}/rows/${item.id}`, {
      data: {
        expected_version: item.version,
        changes: { category, subtype_name: null, name: `参考-${category}` },
      },
    })
    expect(edited.ok()).toBeTruthy()
    item = (await edited.json()).data
    const confirmed = await request.post(`/api/v1/imports/${bid}/confirm`, {
      headers: key(),
      data: { rows: [{ row_id: item.id, expected_version: item.version }] },
    })
    expect(confirmed.ok(), await confirmed.text()).toBeTruthy()
  }
  let calls = 0
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(analyze|generate)$/.test(r.url())) calls++
  })
  await page.goto('/collections')
  await page.getByRole('link', { name: '参考图搭配 →' }).click()
  await page.getByLabel('选择参考图').setInputFiles('e2e/fixtures/shirt.png')
  await page.getByRole('button', { name: '上传参考图', exact: true }).click()
  await expect(page).toHaveURL(/\/collections\/reference\/[\w-]+$/)
  const id = page.url().split('/').at(-1)!
  await page.reload()
  await expect(page.getByRole('button', { name: '分析参考图', exact: true })).toBeVisible()
  expect(calls).toBe(0)
  await page.getByRole('button', { name: '分析参考图', exact: true }).click()
  await page.getByRole('button', { name: '确认分析', exact: true }).click()
  await expect(page.getByRole('heading', { name: '核对参考线索' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('button', { name: '确认这些线索' })).toBeEnabled()
  await page.getByRole('button', { name: '黑色', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '黑色', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(calls).toBe(1)
  let lost = true
  const writes: string[] = []
  await page.route(`**/api/v1/references/${id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    writes.push(route.request().headers()['idempotency-key'])
    const response = await route.fetch()
    if (lost) {
      lost = false
      return route.abort('failed')
    }
    return route.fulfill({ response })
  })
  await page.getByRole('button', { name: '确认这些线索' }).click()
  await expect(page.getByRole('button', { name: '重发原操作' })).toBeVisible()
  await page.reload()
  expect(calls).toBe(1)
  await page.getByRole('button', { name: '重发原操作' }).click()
  await expect(page.getByRole('button', { name: '生成近似搭配', exact: true })).toBeEnabled()
  expect(writes[0]).toBe(writes[1])
  await page.getByRole('button', { name: '生成近似搭配', exact: true }).click()
  await expect(page.getByRole('link', { name: '查看、收藏或记录穿着' })).toBeVisible({
    timeout: 30000,
  })
  await page.reload()
  await expect(page.getByRole('link', { name: '查看、收藏或记录穿着' })).toBeVisible()
  expect(calls).toBe(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.locator('.reference-results').scrollIntoViewIfNeeded()
  await expect
    .poll(async () =>
      page
        .locator('.reference-pieces img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBeTruthy()
  await page.screenshot({ path: info.outputPath('reference-result.png'), fullPage: true })
  const reference = await get(`/references/${id}`)
  const revision = await get(`/outfit-revisions/${reference.revision_ids[0]}`)
  await page.getByRole('button', { name: '删除参考记录', exact: true }).click()
  await page.getByRole('button', { name: '确认删除参考记录', exact: true }).click()
  await expect(page).toHaveURL(/\/collections\/reference$/)
  expect((await request.get(reference.image_url)).status()).toBe(404)
  expect(await get(`/outfit-revisions/${revision.id}`)).toEqual(revision)
  expect((await request.get(revision.items[0].image_url)).ok()).toBeTruthy()
  expect(errors).toEqual([])
})
