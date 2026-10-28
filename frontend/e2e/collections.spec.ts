import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

test('history snapshots survive garment deletion and history hiding; favorites and wear remain independent', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000)
  const headers = { 'Idempotency-Key': randomUUID() }
  const fixture = await readFile(new URL('./fixtures/shirt.png', import.meta.url))
  const response = await request.post('/api/v1/imports/photos', {
    headers,
    multipart: { files: { name: 'p5-shirt.png', mimeType: 'image/png', buffer: fixture } },
  })
  expect(response.ok()).toBe(true)
  const batchId = (await response.json()).data.import_batch_id
  await expect
    .poll(
      async () => (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data.job_status,
      { timeout: 60000 },
    )
    .toBe('succeeded')
  const batch = (await (await request.get(`/api/v1/imports/${batchId}`)).json()).data
  const row = batch.rows[0]
  const patched = await request.patch(`/api/v1/imports/${batchId}/rows/${row.id}`, {
    data: { expected_version: row.version, changes: { category: 'top', name: 'P5 E2E 上衣' } },
  })
  const edited = (await patched.json()).data
  const confirmed = await request.post(`/api/v1/imports/${batchId}/confirm`, {
    headers: { 'Idempotency-Key': randomUUID() },
    data: { rows: [{ row_id: row.id, expected_version: edited.version }] },
  })
  const gid = (await confirmed.json()).data.rows[0].garment_id
  let favoriteId: string | undefined
  let wearId: string | undefined
  try {
    const created = await request.post('/api/v1/outfit-sessions', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: {
        requirements: {
          notes: 'P5 E2E 验证',
          weather_override: { temperature_c: 20, condition: '晴' },
        },
      },
    })
    const session = (await created.json()).data
    const generated = await request.post(`/api/v1/outfit-sessions/${session.id}/generate`, {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { expected_version: session.version },
    })
    const jobId = (await generated.json()).data.job_id
    await expect
      .poll(async () => (await (await request.get(`/api/v1/jobs/${jobId}`)).json()).data.status, {
        timeout: 30000,
      })
      .toBe('succeeded')
    const saved = (await (await request.get(`/api/v1/outfit-sessions/${session.id}`)).json()).data
    const rid = saved.selected_revision_id
    const revision = saved.revisions.find((r: { id: string }) => r.id === rid)
    const image = revision.items.find((i: { image_url: string }) => i.image_url).image_url
    const pixels = await (await request.get(image)).body()
    let modelPosts = 0
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/(generate|adjust|retry)$/.test(req.url())) modelPosts++
    })
    await page.goto(`/collections/${rid}`)
    await page.getByLabel('收藏名称').fill(`P5 收藏 ${testInfo.project.name}`)
    await page.getByRole('button', { name: '收藏此版本' }).click()
    await expect(page.getByRole('status')).toHaveText('操作已保存。')
    const favorites = (await (await request.get('/api/v1/favorites')).json()).data.items
    favoriteId = favorites.find((f: { revision_id: string }) => f.revision_id === rid).id
    const beforeWears = (await (await request.get('/api/v1/wear-records')).json()).data.items
    expect(beforeWears.some((w: { revision_id: string }) => w.revision_id === rid)).toBe(false)
    await page.getByLabel('穿着备注').fill('P5 浏览器验证')
    await page.getByRole('button', { name: '记录穿着', exact: true }).click()
    await expect
      .poll(async () =>
        (await (await request.get('/api/v1/wear-records')).json()).data.items.some(
          (w: { revision_id: string }) => w.revision_id === rid,
        ),
      )
      .toBe(true)
    wearId = (await (await request.get('/api/v1/wear-records')).json()).data.items.find(
      (w: { revision_id: string }) => w.revision_id === rid,
    ).id
    const garment = (await (await request.get(`/api/v1/garments/${gid}`)).json()).data
    expect(
      (
        await request.delete(`/api/v1/garments/${gid}`, {
          headers: { 'If-Match': String(garment.version) },
        })
      ).ok(),
    ).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: /Fake 模拟搭配/ })).toBeVisible()
    expect(await (await request.get(image)).body()).toEqual(pixels)
    await page.goto('/collections')
    const card = page
      .locator('.outfit-card')
      .filter({ has: page.locator(`a[href="/collections/${rid}"]`) })
    page.once('dialog', (d) => d.accept())
    await card.getByRole('button', { name: '从历史删除' }).click()
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: '收藏', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: `P5 收藏 ${testInfo.project.name}` }),
    ).toBeVisible()
    await page.goto('/calendar')
    await expect(page.getByLabel('备注').filter({ visible: true })).toHaveCount(1)
    await page.getByLabel('备注').fill('P5 修改穿着备注')
    await page.getByRole('button', { name: '保存穿着记录' }).click()
    await expect(page.getByRole('status')).toHaveText('操作已保存。')
    await page.screenshot({ path: testInfo.outputPath('p5-calendar.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(modelPosts).toBe(0)
    expect(errors).toEqual([])
  } finally {
    for (const [path, id] of [
      ['favorites', favoriteId],
      ['wear-records', wearId],
    ] as const) {
      if (!id) continue
      const rows = (await (await request.get(`/api/v1/${path}`)).json()).data.items
      const item = rows.find((item: { id: string }) => item.id === id)
      if (item)
        await request.delete(`/api/v1/${path}/${id}`, {
          headers: { 'If-Match': String(item.version), 'Idempotency-Key': randomUUID() },
        })
    }
    const response = await request.get(`/api/v1/garments/${gid}`)
    if (response.ok())
      await request.delete(`/api/v1/garments/${gid}`, {
        headers: { 'If-Match': String((await response.json()).data.version) },
      })
  }
})

test('backup export downloads and validates without applying to the running database', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120000)
  const before = (await (await request.get('/api/v1/capabilities')).json()).data.data_epoch
  await page.goto('/settings/backups')
  await page.getByRole('button', { name: '创建完整备份' }).click()
  const link = page.getByRole('link', { name: /下载备份 ZIP/ })
  await expect(link).toBeVisible({ timeout: 60000 })
  const response = await request.get((await link.getAttribute('href'))!)
  expect(response.ok()).toBe(true)
  await page.getByLabel('备份文件', { exact: true }).setInputFiles({
    name: 'p5-backup.zip',
    mimeType: 'application/zip',
    buffer: await response.body(),
  })
  await page.getByRole('button', { name: '上传并验证', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认覆盖恢复' })).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('button', { name: '确认覆盖恢复' })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: '确认覆盖恢复' })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认覆盖恢复' })).toBeDisabled()
  expect((await (await request.get('/api/v1/capabilities')).json()).data.data_epoch).toBe(before)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('p5-backup.png'), fullPage: true })
})
