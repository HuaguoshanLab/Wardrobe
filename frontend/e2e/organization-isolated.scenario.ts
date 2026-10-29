import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

test('W3 supply partial fulfillment, retained decisions and stale exit preview', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.P6_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  const name = `W3衬衫-${info.project.name}-${Date.now()}`
  const upload = await request.post('/api/v1/imports/photos', {
    headers: key(),
    multipart: {
      files: {
        name: 'w3.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
      },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const batch = (await upload.json()).data.import_batch_id
  let row: { id: string; version: number; row_status: string }
  await expect
    .poll(
      async () => {
        const batchState = (await (await request.get(`/api/v1/imports/${batch}`)).json()).data
        row = batchState.rows[0]
        return batchState.job_status === 'succeeded' ? row.row_status : batchState.job_status
      },
      { timeout: 60000 },
    )
    .toBe('ready')
  const confirmation = await request.post(`/api/v1/imports/${batch}/confirm`, {
    headers: key(),
    data: { rows: [{ row_id: row!.id, expected_version: row!.version }] },
  })
  const gid = (await confirmation.json()).data.rows[0].garment_id
  const gp = `/api/v1/garments/${gid}`
  let g = (await (await request.get(gp)).json()).data
  let r = await request.patch(gp, {
    headers: key(),
    data: {
      expected_version: g.version,
      changes: { name, seasons: ['summer', 'autumn'], category: 'top' },
    },
  })
  expect(r.ok()).toBeTruthy()
  g = (await r.json()).data
  r = await request.post(`${gp}/lifecycle`, {
    headers: key(),
    data: {
      expected_version: g.version,
      action: 'condition',
      occurred_on: '2026-01-01',
      changes: { condition: 'good', fit: 'fits' },
    },
  })
  expect(r.ok()).toBeTruthy()
  const demands = []
  for (const season of ['summer', 'autumn']) {
    const cfg = (await (await request.get(`/api/v1/inventory/${season}`)).json()).data.plan
    const d = {
      id: randomUUID(),
      name: `W3需求-${season}-${name}`,
      category: 'top',
      lower: 0,
      upper: 0,
    }
    demands.push(d)
    expect(
      (
        await request.post(`/api/v1/inventory/${season}`, {
          headers: key(),
          data: { expected_version: cfg.version, rows: [d] },
        })
      ).ok(),
    ).toBeTruthy()
  }
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/wardrobe/organization')
  await page.getByRole('link', { name: '手工添加', exact: true }).click()
  await page.getByLabel('计划名称', { exact: true }).fill(`补充-${name}`)
  await page.getByLabel('计划数量', { exact: true }).fill('2')
  await page.getByLabel('总预算（元，可不填）', { exact: true }).fill('0')
  await page.getByLabel('计划状态', { exact: true }).selectOption('purchased')
  await page.getByText('关联季节需求 · 0 项', { exact: true }).click()
  for (const d of demands) await page.getByLabel(new RegExp(d.name)).check()
  await page.getByRole('button', { name: '保存补充计划', exact: true }).click()
  await expect(page.getByRole('heading', { name: `补充-${name}`, exact: true })).toBeVisible()
  const planId = page.url().split('/').at(-1)!
  await page.getByRole('button', { name: '关联正式单品', exact: true }).click()
  await page.getByLabel('查找正式单品', { exact: true }).fill(name)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: '确认关联这件', exact: true }).click()
  await expect(page.getByText('还有 1 件待完成', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('还有 1 件待完成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消剩余 1 件', exact: true }).click()
  await page.getByRole('button', { name: '确认取消剩余数量', exact: true }).click()
  await expect(page.getByText('已完成', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: info.outputPath('w3-supply.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.goto(`/wardrobe/organization/garments/${gid}?reason=excess:${demands[0].id}`)
  await page.getByRole('radio', { name: /^继续保留/ }).check()
  await page.getByLabel('决定原因', { exact: true }).fill('保留作轮换，不按超额自动丢弃')
  await page.getByRole('button', { name: '保存整理决定', exact: true }).click()
  await expect(page.getByRole('heading', { name: '补充与处理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '已保留', exact: true }).click()
  await expect(
    page.getByText('保留作轮换，不按超额自动丢弃', { exact: false }).first(),
  ).toBeVisible()
  await page.goto(`/wardrobe/organization/garments/${gid}?reason=excess:${demands[0].id}`)
  await page.getByRole('button', { name: '执行实际处理', exact: true }).click()
  await page.getByLabel('实际处理方式', { exact: true }).selectOption('gifted')
  await expect(page.getByText('退出后，会影响这些需求', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '确认退出衣橱', exact: true })).toBeDisabled()
  await page.getByLabel('已核对全部季节影响，确认实际退出', { exact: true }).check()
  // Another page edits the goal after the preview. The stale action must not execute.
  const cfg = (await (await request.get('/api/v1/inventory/summer')).json()).data.plan
  const targetChange = await request.post('/api/v1/inventory/summer', {
    headers: key(),
    data: {
      ...cfg,
      expected_version: cfg.version,
      rows: cfg.rows.map((d: { id: string }) => ({ ...d, lower: 1, upper: 2 })),
      season: undefined,
      version: undefined,
    },
  })
  expect(targetChange.ok()).toBeTruthy()
  await page.getByRole('button', { name: '确认退出衣橱', exact: true }).click()
  await expect(
    page.getByText('衣橱或目标已变化，请重新读取退出影响并确认', { exact: true }),
  ).toBeVisible()
  expect((await (await request.get(gp)).json()).data.ownership).toBe('owned')
  await page.getByRole('button', { name: '重新核对退出影响', exact: true }).click()
  await page.getByLabel('已核对全部季节影响，确认实际退出', { exact: true }).check()
  await page.screenshot({ path: info.outputPath('w3-exit-preview.png') })
  await page.getByRole('button', { name: '确认退出衣橱', exact: true }).click()
  await expect(page.getByRole('heading', { name: '补充与处理', exact: true })).toBeVisible()
  expect((await (await request.get(gp)).json()).data.ownership).toBe('retired')
  const completed = (await (await request.get(`/api/v1/supply-plans/${planId}`)).json()).data
  expect(completed.status).toBe('completed')
  expect(completed.linked[0].archived).toBe(true)
  expect(errors).toEqual([])
})
