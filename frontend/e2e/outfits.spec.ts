import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

test('generate, reload, lock, replace and chat preserve snapshots and avoid duplicate model jobs', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(180000)
  const created: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const fixture = await readFile(new URL('./fixtures/shirt.png', import.meta.url))
  const categories = ['top', 'bottom', 'bottom', 'shoes', 'outerwear']
  const form = new FormData()
  for (let i = 0; i < categories.length; i++)
    form.append('files', new File([fixture], `p4-${i}.png`, { type: 'image/png' }))
  const upload = await request.post('/api/v1/imports/photos', {
    headers: { 'Idempotency-Key': randomUUID() },
    multipart: form,
  })
  expect(upload.ok()).toBe(true)
  const batchId = (await upload.json()).data.import_batch_id
  try {
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data.job_status,
        { timeout: 120000 },
      )
      .toBe('succeeded')
    const batch = (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data
    const rows: { row_id: string; expected_version: number }[] = []
    for (const [index, row] of batch.rows.entries()) {
      const updated = await request.patch(`/api/v1/imports/${batchId}/rows/${row.id}`, {
        data: {
          expected_version: row.version,
          changes: {
            category: categories[index],
            name: `P4-${categories[index]}-${index}`,
            display_variant: 'original',
          },
        },
      })
      expect(updated.ok()).toBe(true)
      const data = (await updated.json()).data
      rows.push({ row_id: data.id, expected_version: data.version })
    }
    const confirmed = await request.post(`/api/v1/imports/${batchId}/confirm`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { rows },
    })
    for (const row of (await confirmed.json()).data.rows) {
      expect(row.status).toBe('confirmed')
      created.push(row.garment_id)
    }
    let modelPosts = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/(generate|adjust|retry)$/.test(req.url())) modelPosts++
    })
    await page.goto('/')
    await page.getByRole('button', { name: '新建搭配会话' }).click()
    await expect(page.getByRole('link', { name: '打开此会话' })).toBeVisible()
    await page.getByLabel('本次补充要求').fill('P4 E2E 验证')
    await page.getByLabel('天气来源').selectOption('manual')
    await page.getByLabel('手动温度（℃）').fill('0')
    await page.getByLabel('天气现象').fill('阴天')
    await page.getByRole('button', { name: '生成搭配', exact: true }).click()
    await expect(page.locator('.outfit-card').first()).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: '重搭未锁定部分' })).toBeEnabled()
    const session = async () =>
      (await (await request.get('/api/v1/outfit-sessions/current')).json()).data
    let saved = await session()
    const base = saved.revisions.find((r: { id: string }) => r.id === saved.selected_revision_id)
    expect(base.provider_mode).toBe('fake')
    expect(saved.revisions.length).toBeLessThanOrEqual(3)
    expect(modelPosts).toBe(1)
    await page.reload()
    await expect(page.getByRole('button', { name: '重搭未锁定部分' })).toBeEnabled()
    expect(modelPosts).toBe(1)
    const selected = page
      .locator('.outfit-card')
      .filter({ has: page.getByRole('heading', { name: /已选方案/ }) })
    const outerwearItem = base.items.find((i: { slot: string }) => i.slot === 'outerwear')
    const outerwear = selected.locator(`[data-item-id="${outerwearItem.item_id}"]`)
    await outerwear.getByLabel('锁定此单品').click()
    await expect(outerwear.getByLabel('锁定此单品')).toBeChecked()
    await expect.poll(async () => (await session()).locked_garment_ids.length).toBe(1)
    const target = base.items.find((i: { slot: string }) => i.slot === 'bottom')
    const kept = base.items.filter((i: { item_id: string }) => i.item_id !== target.item_id)
    await selected
      .locator(`[data-item-id="${target.item_id}"]`)
      .getByRole('button', { name: '只替换此项' })
      .click()
    await expect.poll(async () => (await session()).selected_revision_id).not.toBe(base.id)
    saved = await session()
    const updated = saved.revisions.find((r: { id: string }) => r.id === saved.selected_revision_id)
    for (const item of kept) expect(updated.items).toContainEqual(item)
    expect(updated.items.map((i: { garment_id: string }) => i.garment_id)).not.toContain(
      target.garment_id,
    )
    await expect(page.getByRole('button', { name: '重搭未锁定部分' })).toBeEnabled()
    await page.getByLabel('聊天调整要求').fill('只换裤子')
    await page.getByRole('button', { name: '发送调整要求' }).click()
    await expect.poll(async () => (await session()).selected_revision_id).not.toBe(updated.id)
    saved = await session()
    expect(saved.locked_garment_ids).toHaveLength(1)
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await otherPage.goto(
      (process.env.E2E_BASE_URL ?? 'http://localhost:8088') + `/outfits/${saved.id}`,
    )
    await expect(otherPage.locator('.outfit-card').first()).toBeVisible()
    expect(await otherPage.locator('input[type=checkbox]:checked').count()).toBeGreaterThanOrEqual(
      1,
    )
    await other.close()
    expect(modelPosts).toBe(3)
    expect(errors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('p4-outfits.png'), fullPage: true })
  } finally {
    for (const id of created) {
      const response = await request.get(`/api/v1/garments/${id}`)
      if (response.ok())
        await request.delete(`/api/v1/garments/${id}`, {
          headers: { 'If-Match': String((await response.json()).data.version) },
        })
    }
  }
})
