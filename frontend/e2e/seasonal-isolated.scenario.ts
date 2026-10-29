import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

test('W4 resume, cross-page stale review, partial results, lost response and frozen summary', async ({
  page,
  request,
}, info) => {
  test.skip(process.env.P6_ISOLATED_REGRESSION !== '1', 'Requires isolated Fake stack')
  const key = () => ({ 'Idempotency-Key': randomUUID() })
  const names = [`W4甲-${Date.now()}`, `W4乙-${Date.now()}`]
  const ids: string[] = []
  for (const name of names) {
    const uploaded = await request.post('/api/v1/imports/photos', {
      headers: key(),
      multipart: {
        files: {
          name: 'w4.png',
          mimeType: 'image/png',
          buffer: await readFile(new URL('./fixtures/shirt.png', import.meta.url)),
        },
      },
    })
    expect(uploaded.ok()).toBeTruthy()
    const bid = (await uploaded.json()).data.import_batch_id
    let row: { id: string; version: number; row_status: string }
    await expect
      .poll(
        async () => {
          const batchState = (await (await request.get(`/api/v1/imports/${bid}`)).json()).data
          row = batchState.rows[0]
          return batchState.job_status === 'succeeded' ? row.row_status : batchState.job_status
        },
        { timeout: 60000 },
      )
      .toBe('ready')
    const result = await request.post(`/api/v1/imports/${bid}/confirm`, {
      headers: key(),
      data: { rows: [{ row_id: row!.id, expected_version: row!.version }] },
    })
    const id = (await result.json()).data.rows[0].garment_id
    ids.push(id)
    const g = (await (await request.get(`/api/v1/garments/${id}`)).json()).data
    expect(
      (
        await request.patch(`/api/v1/garments/${id}`, {
          data: {
            expected_version: g.version,
            changes: { name, category: 'other_accessory', seasons: ['winter'] },
          },
        })
      ).ok(),
    ).toBeTruthy()
  }
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let modelWrites = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/(generate|recognize|imports\/photos)/.test(r.url()))
      modelWrites++
  })
  await page.goto('/wardrobe/seasonal')
  await page.getByRole('button', { name: '选择季节与范围' }).click()
  await page.getByLabel('整理季节').selectOption('winter')
  await page.getByRole('combobox', { name: '品类', exact: true }).selectOption('other_accessory')
  await page.getByRole('button', { name: '创建并开始核对' }).click()
  await expect(page).toHaveURL(/\/wardrobe\/seasonal\/.+/)
  const sid = page.url().split('/').at(-1)!
  const sp = `/api/v1/seasonal-sessions/${sid}`
  const read = async () => (await (await request.get(sp)).json()).data
  const card = (name: string) =>
    page.locator('.seasonal-item').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await card(names[0]).getByRole('button', { name: '核对这件' }).click()
  // Return links keep the seasonal context even across reloads and W1/W2 pages.
  await page.getByRole('link', { name: '修改分类与属性' }).click()
  await expect(page).toHaveURL(new RegExp(`/wardrobe/${ids[0]}$`))
  await page.reload()
  await page.getByRole('link', { name: '返回本轮整理' }).click()
  await expect(page).toHaveURL(new RegExp(`/wardrobe/seasonal/${sid}$`))
  await card(names[0]).getByRole('button', { name: '核对这件' }).click()
  await page.getByRole('link', { name: '修改状况与资料' }).click()
  await expect(page).toHaveURL(new RegExp(`/wardrobe/${ids[0]}/lifecycle$`))
  await page.reload()
  await page.getByRole('link', { name: '返回本轮整理' }).click()
  await card(names[0]).getByRole('button', { name: '核对这件' }).click()
  await page.getByLabel('留给自己的待办').fill('试穿后再决定')
  await page.getByRole('link', { name: '暂停整理，稍后继续' }).click()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await expect(page.getByLabel('留给自己的待办')).toHaveValue('试穿后再决定')
  await page.getByRole('button', { name: '取消未保存修改' }).click()
  expect(
    (await read()).items.find((i: { garment_id: string }) => i.garment_id === ids[0]).todo,
  ).toBe('')
  for (const name of names) {
    await card(name).getByRole('button', { name: '核对这件' }).click()
    await page.getByLabel('已查看当前资料与实际状况').check()
    await page.getByLabel('留给自己的待办').fill('准备收纳')
    await page.getByRole('button', { name: '保存这件核对' }).click()
    await expect(card(name)).toHaveCount(0)
  }
  await page.getByRole('link', { name: '暂停整理，稍后继续' }).click()
  await page.goto(`/wardrobe/seasonal/${sid}`)
  await page.reload()
  expect((await read()).preview.reviewed).toBe(2)
  // A real mutation in another page invalidates the saved review.
  const gp = `/api/v1/garments/${ids[0]}`
  let g = (await (await request.get(gp)).json()).data
  expect(
    (
      await request.patch(gp, {
        data: { expected_version: g.version, changes: { material: 'cotton' } },
      })
    ).ok(),
  ).toBeTruthy()
  await page.getByRole('button', { name: '读取最新状态', exact: true }).click()
  await expect(card(names[0])).toContainText('资料已变化')
  await card(names[0]).getByRole('button', { name: '重新核对', exact: true }).click()
  await page.getByLabel('已查看当前资料与实际状况').check()
  await page.getByRole('button', { name: '保存这件核对' }).click()
  await expect(card(names[0])).toHaveCount(0)
  await page.getByRole('button', { name: /2\s*调整目标/ }).click()
  await page.getByRole('link', { name: '编辑本季目标' }).click()
  await expect(page).toHaveURL(/\/wardrobe\/inventory\/winter\/edit$/)
  await page.reload()
  await page.getByRole('link', { name: '返回本轮整理' }).click()
  await expect(page.getByRole('heading', { name: '冬季，需要多少件才够' })).toBeVisible()
  await page.getByRole('button', { name: '确认当前目标与规则' }).click()
  await expect(page.getByRole('button', { name: '确认当前目标与规则' })).toBeDisabled()
  await page.getByRole('button', { name: /3\s*逐件处理/ }).click()
  for (const name of names)
    await page.locator('.seasonal-pick').filter({ hasText: name }).getByRole('checkbox').check()
  await page.getByRole('button', { name: /^核对并执行/ }).click()
  await page.getByLabel('我已核对对象与动作，确认现在执行').check()
  // Simulate a concurrent wardrobe edit after the review and an already-committed lost response.
  const gp2 = `/api/v1/garments/${ids[1]}`
  g = (await (await request.get(gp2)).json()).data
  expect(
    (
      await request.patch(gp2, {
        data: { expected_version: g.version, changes: { material: 'cotton' } },
      })
    ).ok(),
  ).toBeTruthy()
  await page.route(
    `**${sp}/actions`,
    async (route) => {
      await route.fetch()
      await route.abort('failed')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: '确认执行换季收纳' }).click()
  await page.getByRole('button', { name: '返回修改', exact: true }).click()
  await expect(page.getByRole('button', { name: '重发同一操作' })).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.reload()
  await expect(page.getByRole('button', { name: '重发同一操作' })).toBeVisible()
  expect((await read()).actions).toHaveLength(2)
  await page.getByRole('button', { name: '重发同一操作' }).click()
  await expect(page.getByRole('button', { name: '重发同一操作' })).toHaveCount(0)
  await expect(page.locator('.seasonal-history')).toContainText('1 项成功 / 1 项失败')
  expect((await read()).actions).toHaveLength(2)
  await page.locator('.seasonal-pick').filter({ hasText: names[1] }).getByRole('checkbox').check()
  await page.getByRole('button', { name: /^核对并执行/ }).click()
  await page.getByLabel('我已核对对象与动作，确认现在执行').check()
  await page.getByRole('button', { name: '确认执行换季收纳' }).click()
  await expect(page.locator('.seasonal-history')).toContainText('2 项成功 / 1 项失败')
  await page.getByRole('button', { name: /1\s*核对单品/ }).click()
  await card(names[1]).getByRole('button', { name: '重新核对', exact: true }).click()
  await page.getByLabel('已查看当前资料与实际状况').check()
  await page.getByRole('button', { name: '保存这件核对' }).click()
  await expect(card(names[1])).toHaveCount(0)
  await page.getByRole('button', { name: /4\s*整理总结/ }).click()
  await page.getByLabel('我已核对总结，并保留上面列出的未解决项').check()
  await page.getByRole('button', { name: '保存本轮总结' }).click()
  await expect(page.getByRole('heading', { name: '本轮总结已保存' })).toBeVisible()
  const finished = await read()
  expect(finished.summary.unresolved.some((s: string) => s.includes('准备收纳'))).toBe(true)
  g = (await (await request.get(gp)).json()).data
  expect(
    (
      await request.patch(gp, {
        data: { expected_version: g.version, changes: { name: '之后修改的名称' } },
      })
    ).ok(),
  ).toBeTruthy()
  await page.reload()
  expect(await read()).toEqual(finished)
  expect(modelWrites).toBe(0)
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('w4-summary.png'), fullPage: true })
  for (const id of ids) {
    const latest = (await (await request.get(`/api/v1/garments/${id}`)).json()).data
    await request.delete(`/api/v1/garments/${id}`, {
      headers: { 'If-Match': String(latest.version) },
    })
  }
})
