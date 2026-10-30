import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('rotation: local draft, explicit generation, frozen evidence, history and reuse', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.P7_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const upload = await request.post('/api/v1/imports/photos', {
    headers: { 'Idempotency-Key': randomUUID() },
    multipart: {
      files: {
        name: 'rotation.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const batchId = (await upload.json()).data.import_batch_id
  await expect
    .poll(
      async () => (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data.job_status,
      { timeout: 60000 },
    )
    .toBe('succeeded')
  const row = (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data.rows[0]
  const confirmed = await request.post(`/api/v1/imports/${batchId}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { rows: [{ row_id: row.id, expected_version: row.version }] },
  })
  const gid = (await confirmed.json()).data.rows[0].garment_id
  const garment = (await (await request.get(`/api/v1/garments/${gid}`)).json()).data
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const recorded = await request.post('/api/v1/manual-outfits', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {
      mode: 'wear',
      worn_on: date,
      items: [{ garment_id: gid, expected_version: garment.version }],
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const created = await request.post('/api/v1/outfit-sessions', {
    headers: { 'Idempotency-Key': randomUUID() },
    data: {},
  })
  const sid = (await created.json()).data.id
  let generationPosts = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/(generate|adjust|retry)$/.test(req.url())) generationPosts++
  })
  await page.goto(`/outfits/${sid}/prepare`)
  await expect(page.getByRole('radio', { name: /正常推荐/ })).toBeChecked()
  await page.getByRole('radio', { name: /优先近期少穿/ }).check()
  await page.reload()
  await expect(page.getByRole('radio', { name: /优先近期少穿/ })).toBeChecked()
  expect(generationPosts).toBe(0)
  await page.getByText(/^天气与城市/).click()
  await page.getByLabel('天气来源').selectOption('manual')
  await page.getByLabel('手动温度（℃）').fill('22')
  await page.getByLabel('天气现象').fill('晴')
  await expect(page.locator('.rotation-option').first()).toHaveCSS('flex-direction', 'row')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('rotation-conditions.png'), fullPage: true })
  await page.getByRole('button', { name: '生成搭配', exact: true }).click()
  const evidence = page.getByRole('region', { name: '轮换依据' })
  await expect(evidence).toBeVisible({ timeout: 30000 })
  await expect(evidence).toContainText('优先近期少穿')
  await expect(evidence).toContainText('同一单品同一天只计一次')
  expect(generationPosts).toBe(1)
  const s = (await (await request.get(`/api/v1/outfit-sessions/${sid}`)).json()).data
  const revision = s.revisions.find((r: { id: string }) => r.id === s.selected_revision_id)
  await page.reload()
  await expect(evidence).toBeVisible()
  expect(generationPosts).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('rotation-result.png'), fullPage: true })
  await page.goto(`/collections/${revision.id}`)
  await expect(evidence).toBeVisible()
  await page.getByRole('button', { name: '以这套为基础搭配', exact: true }).click()
  await page.getByRole('button', { name: '继续搭配', exact: true }).click()
  await page.getByRole('link', { name: '重新搭配', exact: true }).click()
  await expect(page.getByRole('radio', { name: /优先近期少穿/ })).toBeChecked()
  expect(generationPosts).toBe(1)
  expect(errors).toEqual([])
})
