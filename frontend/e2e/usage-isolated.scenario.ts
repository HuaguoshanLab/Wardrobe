import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('usage: actual wear aggregation, explicit anchored generation and current availability', async ({
  page,
  request,
}, info) => {
  page.setDefaultTimeout(15000)
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  const upload = await request.post('/api/v1/imports/photos', {
    headers: key(),
    multipart: {
      files: {
        name: 'usage.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const bid = (await upload.json()).data.import_batch_id
  await expect
    .poll(
      async () => (await (await request.get(`/api/v1/imports/${bid}`)).json()).data.job_status,
      { timeout: 90000 },
    )
    .toBe('succeeded')
  const row = (await (await request.get(`/api/v1/imports/${bid}`)).json()).data.rows[0]
  const confirm = await request.post(`/api/v1/imports/${bid}/confirm`, {
    headers: key(),
    data: { rows: [{ row_id: row.id, expected_version: row.version }] },
  })
  const gid = (await confirm.json()).data.rows[0].garment_id
  let garment = (await (await request.get(`/api/v1/garments/${gid}`)).json()).data
  const name = `利用情况验收-${gid.slice(0, 8)}`
  garment = (
    await (
      await request.patch(`/api/v1/garments/${gid}`, {
        data: { expected_version: garment.version, changes: { name } },
      })
    ).json()
  ).data
  let generations = 0
  const writes: string[] = []
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.url().includes('/api/v1')) writes.push(req.url())
    if (req.method() === 'POST' && req.url().endsWith('/generate')) generations++
  })
  await page.goto('/wardrobe/usage?view=unrecorded')
  const card = page
    .locator('.usage-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
  await expect(card).toContainText('期间无记录')
  await card.getByRole('link', { name: '围绕这件搭配' }).click()
  await expect(page.getByRole('region', { name: '指定搭配单品' })).toContainText(name)
  await page.reload()
  expect(writes).toEqual([])
  await expect(page.getByRole('heading', { name: '今天想怎么穿？' })).toBeVisible()
  if (!(await page.getByLabel('天气来源').isVisible())) await page.getByText(/^天气与城市/).click()
  await page.getByLabel('天气来源').selectOption('manual')
  await page.getByLabel('手动温度（℃）').fill('20')
  await page.getByLabel('天气现象').fill('晴')
  await page.getByLabel('本次补充要求').fill('围绕指定单品散步')
  let originalKey = '',
    originalBody = ''
  await page.route('**/api/v1/outfit-sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    originalKey = route.request().headers()['idempotency-key']
    originalBody = route.request().postData()!
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '生成搭配', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.unroute('**/api/v1/outfit-sessions')
  await page.reload()
  expect(generations).toBe(0)
  const retry = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith('/outfit-sessions'),
  )
  await page.getByRole('button', { name: '重发同一搭配操作' }).click()
  const replay = await retry
  expect(replay.headers()['idempotency-key']).toBe(originalKey)
  expect(replay.postData()).toBe(originalBody)
  await expect
    .poll(
      async () => {
        const s = (await (await request.get('/api/v1/outfit-sessions/current')).json()).data
        return s?.revisions.length > 0
      },
      { timeout: 30000 },
    )
    .toBe(true)
  const session = (await (await request.get('/api/v1/outfit-sessions/current')).json()).data
  expect(session.locked_garment_ids).toContain(gid)
  for (const rev of session.revisions)
    expect(rev.items.map((i: { garment_id: string }) => i.garment_id)).toContain(gid)
  expect(generations).toBe(1)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const first = (
    await (
      await request.post('/api/v1/manual-outfits', {
        headers: key(),
        data: {
          mode: 'wear',
          worn_on: date,
          items: [{ garment_id: gid, expected_version: garment.version }],
        },
      })
    ).json()
  ).data.wear
  const second = (
    await (
      await request.post('/api/v1/wear-records', {
        headers: key(),
        data: { revision_id: session.revisions[0].id, worn_on: date },
      })
    ).json()
  ).data
  await page.goto('/wardrobe/usage?range=90')
  await expect(card).toContainText('记录穿着 1 天')
  await page.screenshot({ path: info.outputPath('usage-actual.png'), fullPage: true })
  await request.delete(`/api/v1/wear-records/${first.id}`, {
    headers: { ...key(), 'If-Match': String(first.version) },
  })
  await page.reload()
  await expect(card).toContainText('记录穿着 1 天')
  await request.delete(`/api/v1/wear-records/${second.id}`, {
    headers: { ...key(), 'If-Match': String(second.version) },
  })
  await page.goto('/wardrobe/usage?range=90&view=unrecorded')
  await expect(card).toContainText('期间无记录')
  await card.getByRole('link', { name: '围绕这件搭配' }).click()
  await expect(page).toHaveURL(new RegExp(`/outfits/prepare\\?anchor=${gid}`))
  await expect(page.getByRole('region', { name: '指定搭配单品' })).toContainText(name)
  const unavailable = await request.patch(`/api/v1/garments/${gid}`, {
    data: { expected_version: garment.version, changes: { availability: 'unavailable' } },
  })
  expect(unavailable.ok()).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('button', { name: '生成搭配', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: '指定搭配单品' })).toContainText('暂不可穿')
  await page.getByRole('link', { name: '返回利用情况' }).click()
  await expect(card.getByRole('link', { name: '查看可用状态' })).toBeVisible()
  expect(generations).toBe(1)
})
