import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('feedback: actual wear, recovery, explicit preference and next generation, independent deletion', async ({
  page,
  request,
}, info) => {
  page.setDefaultTimeout(15000)
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  const upload = await request.post('/api/v1/imports/photos', {
    headers: key(),
    multipart: {
      files: {
        name: 'feedback.png',
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
  const item = (await (await request.get(`/api/v1/garments/${gid}`)).json()).data
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const created = await request.post('/api/v1/manual-outfits', {
    headers: key(),
    data: {
      mode: 'wear',
      worn_on: date,
      items: [{ garment_id: gid, expected_version: item.version }],
    },
  })
  expect(created.ok()).toBeTruthy()
  const wear = (await created.json()).data.wear
  const before = (await (await request.get('/api/v1/profile/preferences')).json()).data
  const endpoint = `/api/v1/wear-records/${wear.id}/feedback`
  const errors: string[] = []
  let generations = 0
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/(generate|adjust)$/.test(req.url())) generations++
  })
  await page.goto(`/collections?view=calendar&date=${date}&month=${date.slice(0, 7)}`)
  await page.getByRole('link', { name: '穿后反馈', exact: true }).last().click()
  // Select the test record deterministically when prior scenarios left calendar entries.
  await page.goto(`/collections/wear/${wear.id}/feedback`)
  await page.getByRole('combobox', { name: '反馈对象', exact: true }).selectOption(gid)
  await page.getByRole('radio', { name: '偏热', exact: true }).check()
  await page.getByRole('radio', { name: '不舒适', exact: true }).check()
  await page.getByLabel('感受备注（可选）').fill('午后偏闷，希望更透气')
  await page.reload()
  await expect(page.getByRole('radio', { name: '偏热', exact: true })).toBeChecked()
  expect(generations).toBe(0)
  let originalKey = ''
  let originalBody = ''
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    originalKey = route.request().headers()['idempotency-key']
    originalBody = route.request().postData()!
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '保存反馈', exact: true }).click()
  await expect(page.getByRole('button', { name: '重发同一操作' })).toBeVisible()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.unroute(`**${endpoint}`)
  await page.reload()
  const replay = page.waitForRequest(
    (req) => req.method() === 'PATCH' && req.url().endsWith(endpoint),
  )
  await page.getByRole('button', { name: '重发同一操作' }).click()
  const retried = await replay
  expect(retried.headers()['idempotency-key']).toBe(originalKey)
  expect(retried.postData()).toBe(originalBody)
  await expect(page.getByText('反馈已保存，尚未修改长期偏好。')).toBeVisible()
  const saved = (await (await request.get(endpoint)).json()).data
  expect(saved.version).toBe(1)
  expect((await (await request.get('/api/v1/profile/preferences')).json()).data).toEqual(before)
  await page.getByRole('button', { name: '保存为长期偏好', exact: true }).click()
  await expect(page.getByLabel('长期偏好补充')).toBeVisible()
  expect((await (await request.get('/api/v1/profile/preferences')).json()).data).toEqual(before)
  await page.getByLabel('长期偏好补充').fill('明确保存：天气热时优先透气；本次要求优先。')
  await page.getByRole('button', { name: '确认保存长期偏好' }).click()
  await expect(page.getByText('偏好已保存。已保存的穿后反馈独立保留。')).toBeVisible()
  const preference = (await (await request.get('/api/v1/profile/preferences')).json()).data
  expect(preference.preferences.thermal).toBe(before.preferences.thermal)
  await page.screenshot({ path: info.outputPath('feedback-saved.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '用于下次搭配', exact: true }).click()
  await page.getByLabel('下次搭配参考').fill('参考穿后反馈，但本次降温请保暖')
  await page.getByRole('button', { name: '带到搭配条件' }).click()
  await page.getByRole('button', { name: '加入本次补充' }).click()
  await expect(
    page.getByText('穿后反馈已加入本次补充，可继续编辑。点击生成才会使用。'),
  ).toBeVisible()
  expect(generations).toBe(0)
  if (!(await page.getByLabel('天气来源').isVisible())) await page.getByText(/^天气与城市/).click()
  await page.getByLabel('天气来源').selectOption('manual')
  await page.getByLabel('手动温度（℃）').fill('10')
  await page.getByLabel('天气现象').fill('阴')
  await page.getByRole('button', { name: '生成搭配', exact: true }).click()
  await expect
    .poll(
      async () => {
        const s = (await (await request.get('/api/v1/outfit-sessions/current')).json()).data
        return s?.revisions?.some((r: { request_snapshot: { requirements: { notes: string } } }) =>
          r.request_snapshot.requirements.notes?.includes('本次降温请保暖'),
        )
      },
      { timeout: 30000 },
    )
    .toBe(true)
  const current = (await (await request.get('/api/v1/outfit-sessions/current')).json()).data
  expect(current.revisions[0].request_snapshot.preferences.notes).toBe(preference.preferences.notes)
  expect(generations).toBe(1)
  await page.goto(`/collections/wear/${wear.id}/feedback`)
  await page.getByRole('button', { name: '删除反馈', exact: true }).click()
  await page.getByRole('button', { name: '确认删除反馈' }).click()
  await expect(page.getByText('反馈已删除，独立保存的长期偏好保持。')).toBeVisible()
  expect((await (await request.get('/api/v1/profile/preferences')).json()).data).toEqual(preference)
  expect((await (await request.get(endpoint)).json()).data.feedback).toBeNull()
  expect((await request.get(`/api/v1/outfit-revisions/${wear.revision_id}`)).ok()).toBeTruthy()
  expect(errors).toEqual([])
})
