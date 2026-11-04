import { expect, test } from '@playwright/test'

test('deployed locations match complete real inventory and filter without writes', async ({
  page,
  request,
}, info) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.push(route.request().url())
    return route.abort()
  })
  const get = async (path: string) => {
    const r = await request.get(`/api/v1${path}`)
    expect(r.ok()).toBeTruthy()
    return (await r.json()).data
  }
  const counts = new Map<string, number>()
  let cursor = '',
    total = 0
  do {
    const p = new URLSearchParams({ location_mode: 'all', limit: '100' })
    if (cursor) p.set('cursor', cursor)
    const rows = await get(`/garments?${p}`)
    for (const g of rows.items) {
      expect(g.is_demo).toBe(false)
      expect(g.ownership).toBe('owned')
      const value = (g.lifecycle.location ?? '').trim()
      counts.set(value, (counts.get(value) ?? 0) + 1)
      total++
    }
    cursor = rows.next_cursor
  } while (cursor)
  const summary = await get('/wardrobe/locations?limit=100')
  expect(summary.total_garments).toBe(total)
  expect(summary.unassigned_count).toBe(counts.get('') ?? 0)
  let locationPage = summary
  const actual = new Map<string, number>()
  while (true) {
    for (const item of locationPage.items) actual.set(item.location, item.count)
    if (!locationPage.next_cursor) break
    locationPage = await get(
      `/wardrobe/locations?${new URLSearchParams({ limit: '100', cursor: locationPage.next_cursor })}`,
    )
  }
  counts.delete('')
  expect(actual).toEqual(counts)
  await page.goto('/wardrobe')
  await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
  await expect(page.getByRole('button', { name: `全部位置 ${total} 件` })).toBeVisible()
  await page.screenshot({ path: info.outputPath('deployed-locations.png'), animations: 'disabled' })
  await page.getByRole('button', { name: `未填写位置 ${summary.unassigned_count} 件` }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/location_mode=unassigned/)
  await page.reload()
  await expect(page.getByRole('button', { name: '移除筛选：未填写位置' })).toBeVisible()
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
