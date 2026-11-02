import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('care: laundry, exact replay, partial failures, tags, location and unchanged history', async ({
  page,
  request,
}, info) => {
  page.setDefaultTimeout(15000)
  const headers = () => ({ 'Idempotency-Key': randomUUID() })
  const get = async (path: string) => (await (await request.get(`/api/v1${path}`)).json()).data
  const ids: string[] = []
  const prefix = `日常验收-${randomUUID().slice(0, 8)}`
  for (let n = 0; n < 2; n++) {
    const upload = await request.post('/api/v1/imports/photos', {
      headers: headers(),
      multipart: {
        files: {
          name: 'care.png',
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
    const confirm = await request.post(`/api/v1/imports/${bid}/confirm`, {
      headers: headers(),
      data: { rows: [{ row_id: row.id, expected_version: row.version }] },
    })
    expect(confirm.ok()).toBeTruthy()
    const gid = (await confirm.json()).data.rows[0].garment_id
    ids.push(gid)
    const g = await get(`/garments/${gid}`)
    expect(
      (
        await request.patch(`/api/v1/garments/${gid}`, {
          data: { expected_version: g.version, changes: { name: `${prefix}-${n + 1}` } },
        })
      ).ok(),
    ).toBeTruthy()
  }
  const first = await get(`/garments/${ids[0]}`)
  const manual = await request.post('/api/v1/manual-outfits', {
    headers: headers(),
    data: { mode: 'save', items: [{ garment_id: first.id, expected_version: first.version }] },
  })
  expect(manual.ok()).toBeTruthy()
  const revisionId = (await manual.json()).data.revision.id
  const history = await get(`/outfit-revisions/${revisionId}`)
  const errors: string[] = []
  const posts: { key: string; body: string }[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/wardrobe/care/actions'))
      posts.push({ key: r.headers()['idempotency-key'], body: r.postData()! })
  })
  const selectBoth = async () => {
    for (let n = 0; n < 2; n++)
      await page.getByRole('checkbox', { name: `选择：${prefix}-${n + 1}`, exact: true }).check()
  }
  const execute = async (action: string, count = 2) => {
    await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption(action)
    await page.getByRole('button', { name: '核对并继续' }).click()
    await expect(page.getByRole('button', { name: `确认对 ${count} 件执行` })).toBeEnabled()
    await page.getByRole('button', { name: `确认对 ${count} 件执行` }).click()
  }
  await page.goto(`/wardrobe/care?group=available&q=${prefix}`)
  await selectBoth()
  await page.reload()
  await expect(page.getByRole('button', { name: '只看已选（2）' })).toBeVisible()
  expect(posts).toHaveLength(0)
  await page.route('**/api/v1/wardrobe/care/actions', async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await execute('mark_washing')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.unroute('**/api/v1/wardrobe/care/actions')
  await page.reload()
  await expect(page.getByRole('button', { name: '重发原批量请求' })).toBeVisible()
  expect(posts).toHaveLength(1)
  await page.getByRole('button', { name: '重发原批量请求' }).click()
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  expect(posts[1]).toEqual(posts[0])
  for (const gid of ids)
    expect((await get(`/garments/${gid}`)).lifecycle.unavailable_reason).toBe('washing')
  await page.getByRole('button', { name: '收起结果' }).click()
  await page.getByRole('button', { name: '待洗清单', exact: true }).click()
  await selectBoth()
  await execute('wash_done')
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  for (const gid of ids) expect((await get(`/garments/${gid}`)).availability).toBe('available')
  await page.getByRole('button', { name: '收起结果' }).click()
  await page.getByRole('button', { name: '可穿单品', exact: true }).click()
  await selectBoth()
  // Explicitly change one selected garment from another client before confirmation.
  const second = await get(`/garments/${ids[1]}`)
  expect(
    (
      await request.post(`/api/v1/garments/${ids[1]}/lifecycle`, {
        headers: headers(),
        data: {
          expected_version: second.version,
          action: 'availability',
          occurred_on: '2026-10-30',
          changes: { availability: 'unavailable', unavailable_reason: 'repair' },
          reason: '并发维修',
        },
      })
    ).ok(),
  ).toBeTruthy()
  await execute('mark_washing')
  await expect(page.getByText('成功 1 件，未成功 1 件')).toBeVisible()
  await page.screenshot({ path: info.outputPath('care-partial.png'), fullPage: true })
  const count = posts.length
  await page.getByRole('button', { name: '只选未成功项，重新核对' }).click()
  await expect(page.getByRole('checkbox', { name: `选择：${prefix}-2`, exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: `选择：${prefix}-1`, exact: true })).toHaveCount(
    0,
  )
  expect(posts).toHaveLength(count)
  expect((await get(`/garments/${ids[1]}`)).lifecycle.unavailable_reason).toBe('repair')
  await page.getByRole('button', { name: '收起结果' }).click()
  await page.getByRole('button', { name: '清空选择' }).click()
  await page.getByRole('button', { name: '全部单品', exact: true }).click()
  await selectBoth()
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('location_set')
  await page.getByLabel('新收纳位置').fill('衣柜二层')
  await execute('location_set')
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  for (const gid of ids) expect((await get(`/garments/${gid}`)).lifecycle.location).toBe('衣柜二层')
  await page.getByRole('button', { name: '收起结果' }).click()
  const tag = await request.post('/api/v1/tags', { data: { name: prefix } })
  expect(tag.ok()).toBeTruthy()
  const tagId = (await tag.json()).data.id
  await page.reload()
  await selectBoth()
  await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('tags_add')
  await page.getByRole('checkbox', { name: prefix, exact: true }).check()
  await execute('tags_add')
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  for (const gid of ids) expect((await get(`/garments/${gid}`)).custom_tag_ids).toContain(tagId)
  await page.getByRole('button', { name: '收起结果' }).click()
  await selectBoth()
  await execute('tags_remove')
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  for (const gid of ids) expect((await get(`/garments/${gid}`)).custom_tag_ids).not.toContain(tagId)
  await page.getByRole('button', { name: '收起结果' }).click()
  await selectBoth()
  await execute('location_clear')
  await expect(page.getByText('成功 2 件，未成功 0 件')).toBeVisible()
  for (const gid of ids) expect((await get(`/garments/${gid}`)).lifecycle.location).toBeNull()
  expect(await get(`/outfit-revisions/${revisionId}`)).toEqual(history)
  expect(errors).toEqual([])
})
