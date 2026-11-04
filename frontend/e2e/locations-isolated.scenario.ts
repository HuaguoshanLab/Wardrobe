import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('locations: browse exact positions, reuse single and batch drafts, refresh totals and preserve states', async ({
  page,
  request,
}, info) => {
  const headers = () => ({ 'Idempotency-Key': randomUUID() })
  const get = async (path: string) => {
    const response = await request.get(`/api/v1${path}`)
    expect(response.ok()).toBeTruthy()
    return (await response.json()).data
  }
  const prefix = `位置验收-${randomUUID().slice(0, 8)}`
  const a = `${prefix}-A`,
    b = `${prefix}-B`
  const ids: string[] = []
  for (let n = 0; n < 2; n++) {
    const upload = await request.post('/api/v1/imports/photos', {
      headers: headers(),
      multipart: {
        files: {
          name: 'location.png',
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
    ids.push(gid)
    let g = await get(`/garments/${gid}`)
    expect(
      (
        await request.patch(`/api/v1/garments/${gid}`, {
          data: {
            expected_version: g.version,
            changes: { name: `${prefix}-${n}`, category: 'top', seasons: ['winter'] },
          },
        })
      ).ok(),
    ).toBeTruthy()
    g = await get(`/garments/${gid}`)
    expect(
      (
        await request.post(`/api/v1/garments/${gid}/lifecycle`, {
          headers: headers(),
          data: {
            expected_version: g.version,
            action: 'storage',
            occurred_on: '2026-11-04',
            changes: { location: n ? b : a, storage: 'stored' },
          },
        })
      ).ok(),
    ).toBeTruthy()
  }
  let first = await get(`/garments/${ids[0]}`)
  expect(
    (
      await request.post(`/api/v1/garments/${first.id}/lifecycle`, {
        headers: headers(),
        data: {
          expected_version: first.version,
          action: 'availability',
          occurred_on: '2026-11-04',
          changes: { availability: 'unavailable', unavailable_reason: 'washing' },
        },
      })
    ).ok(),
  ).toBeTruthy()
  const forbidden: string[] = [],
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.method() === 'POST' && /generate|outfit-sessions|imports/.test(r.url()))
      forbidden.push(r.url())
  })
  await page.goto(
    `/wardrobe?${new URLSearchParams({ q: prefix, category: 'top', season: 'winter' })}`,
  )
  await expect(page.locator('.garment-card')).toHaveCount(2)
  await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
  await expect(page.getByRole('button', { name: '全部位置 2 件' })).toBeVisible()
  await page.getByRole('button', { name: `${a} 1 件` }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.garment-card')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.garment-card')).toHaveCount(1)
  await page.locator('.garment-card').click()
  await page.getByRole('link', { name: '生命周期 · 获得、收纳与整理' }).click()
  await page.getByRole('button', { name: /^收纳位置/ }).click()
  await page.getByRole('button', { name: '选择已有位置' }).click()
  await page.getByLabel('搜索已有位置').fill(b)
  await page.getByRole('button', { name: `${b} 1 件` }).click()
  await expect(page.getByLabel('收纳位置', { exact: true })).toHaveValue(b)
  first = await get(`/garments/${ids[0]}`)
  expect(first.lifecycle.location).toBe(a)
  await page.getByRole('button', { name: '保存记录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: '返回单品', exact: true }).click()
  await page.getByRole('link', { name: '返回衣橱', exact: true }).click()
  await expect(page.locator('.garment-card')).toHaveCount(0)
  await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
  await expect(page.getByRole('button', { name: `${b} 2 件` })).toBeVisible()
  await expect(page.getByRole('button', { name: `${a} 1 件` })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.goto(`/wardrobe/care?${new URLSearchParams({ group: 'all', q: prefix })}`)
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('location_set')
  await page.getByRole('button', { name: '选择已有位置' }).click()
  await page.getByLabel('搜索已有位置').fill(b)
  await page.getByRole('button', { name: `${b} 2 件` }).click()
  await page.getByLabel('新收纳位置').fill(a)
  for (let n = 0; n < 2; n++)
    await page.getByRole('checkbox', { name: `选择：${prefix}-${n}`, exact: true }).check()
  await page.getByRole('button', { name: '核对并继续' }).click()
  await page.getByRole('button', { name: '确认对 2 件执行' }).click()
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  const after = await get(`/wardrobe/locations?${new URLSearchParams({ q: prefix })}`)
  expect(after.items).toEqual([{ location: a, count: 2 }])
  first = await get(`/garments/${ids[0]}`)
  expect(first.availability).toBe('unavailable')
  expect(first.lifecycle.unavailable_reason).toBe('washing')
  expect(first.lifecycle.storage).toBe('stored')
  await page.screenshot({ path: info.outputPath('locations-moved.png'), animations: 'disabled' })
  expect(forbidden).toEqual([])
  expect(errors).toEqual([])
  for (const gid of ids) {
    const current = await get(`/garments/${gid}`)
    expect(
      (
        await request.delete(`/api/v1/garments/${gid}`, {
          headers: { 'If-Match': String(current.version) },
        })
      ).status(),
    ).toBe(204)
  }
})
