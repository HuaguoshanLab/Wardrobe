import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('templates: save, explicit replace, original request recovery, versions, generation and independent deletion', async ({
  page,
  request,
}, info) => {
  const headers = () => ({ 'Idempotency-Key': randomUUID() })
  const name = `通勤-${randomUUID().slice(0, 8)}`
  const get = async (path: string) => (await (await request.get(`/api/v1${path}`)).json()).data
  const upload = await request.post('/api/v1/imports/photos', {
    headers: headers(),
    multipart: {
      files: {
        name: 'template.png',
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
  const confirmation = await request.post(`/api/v1/imports/${bid}/confirm`, {
    headers: headers(),
    data: { rows: [{ row_id: row.id, expected_version: row.version }] },
  })
  expect(confirmation.ok()).toBeTruthy()
  const gid = (await confirmation.json()).data.rows[0].garment_id
  const s = await request.post('/api/v1/outfit-sessions', {
    headers: headers(),
    data: { anchor_garment_id: gid },
  })
  const sid = (await s.json()).data.id
  let generations = 0
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(generate|adjust|retry)$/.test(r.url())) generations++
  })
  await page.goto(`/outfits/${sid}/prepare`)
  await page.getByLabel('本次补充要求').fill('步行通勤，轻便')
  await page.getByRole('radio', { name: /优先近期少穿/ }).check()
  await page.getByRole('button', { name: '条件模板', exact: true }).click()
  await page.getByRole('button', { name: '将当前条件另存为模板' }).click()
  await page.getByLabel('模板名称').fill(name)
  let lost = true
  const saved: { key: string | null; body: string | null }[] = []
  await page.route('**/api/v1/condition-templates', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    saved.push({
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
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(page.getByRole('button', { name: '重发原模板操作' })).toBeVisible()
  await page.reload()
  expect(generations).toBe(0)
  await page.getByRole('button', { name: '条件模板', exact: true }).click()
  await page.getByRole('button', { name: '重发原模板操作' }).click()
  await expect(page.getByText('模板已保存。', { exact: true })).toBeVisible()
  expect(saved[1]).toEqual(saved[0])
  let t = (await get('/condition-templates')).find((v: { name: string }) => v.name === name)
  expect(Object.keys(t.conditions).sort()).toEqual([
    'custom_tag_ids',
    'notes',
    'occasion_codes',
    'rotation_mode',
    'style_codes',
  ])
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByLabel('本次补充要求').fill('应被替换的旧草稿')
  await page.getByRole('radio', { name: /正常推荐/ }).check()
  await page.getByText(/^天气与城市/).click()
  await page.getByLabel('天气来源').selectOption('manual')
  await page.getByLabel('手动温度（℃）').fill('0')
  await page.getByLabel('天气现象').fill('雪')
  await page.getByRole('button', { name: '条件模板', exact: true }).click()
  await page.getByRole('button', { name: `${name} 查看与选用` }).click()
  await page.getByRole('button', { name: '确认替换当前条件' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('本次补充要求')).toHaveValue('步行通勤，轻便')
  await expect(page.getByLabel('手动温度（℃）')).toHaveValue('0')
  await page.reload()
  await expect(page.getByRole('radio', { name: /优先近期少穿/ })).toBeChecked()
  expect(generations).toBe(0)
  expect((await get(`/outfit-sessions/${sid}`)).locked_garment_ids).toEqual([gid])
  await page.getByRole('button', { name: '生成搭配', exact: true }).click()
  await expect
    .poll(async () => (await get(`/outfit-sessions/${sid}`)).selected_revision_id, {
      timeout: 60000,
    })
    .not.toBeNull()
  expect(generations).toBe(1)
  const after = await get(`/outfit-sessions/${sid}`)
  const revision = await get(`/outfit-revisions/${after.selected_revision_id}`)
  expect(after.requirements.notes).toBe('步行通勤，轻便')
  await page.goto(`/outfits/${sid}/prepare`)
  await page.getByRole('button', { name: '条件模板', exact: true }).click()
  await page.getByRole('button', { name: `${name} 查看与选用` }).click()
  await page.getByRole('button', { name: '编辑模板', exact: true }).click()
  await page.getByLabel('模板名称').fill(`${name}-修改`)
  await page.getByRole('button', { name: '保存模板', exact: true }).click()
  await expect(page.getByText('模板已保存。', { exact: true })).toBeVisible()
  t = await get(`/condition-templates/${t.id}`)
  expect(t.version).toBe(2)
  await page.getByRole('button', { name: `${name}-修改 查看与选用` }).click()
  await page.getByRole('button', { name: '删除模板', exact: true }).click()
  await page.getByRole('button', { name: '确认删除模板' }).click()
  await expect(page.getByText('模板已删除，已有搭配和草稿保持。')).toBeVisible()
  expect(await get(`/outfit-revisions/${after.selected_revision_id}`)).toEqual(revision)
  expect(generations).toBe(1)
  expect(errors).toEqual([])
  await page.screenshot({ path: info.outputPath('templates-complete.png'), animations: 'disabled' })
})
