import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'
import { careGarment } from './care-fixtures'

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`location search, exact URL, error recovery and draft reuse ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    const audit = await mockAudit(page, revision())
    const envelope = (data: unknown) => ({ data, request_id: id(99) })
    const long = '很长的收纳位置'.repeat(15)
    let fail = false
    await page.route('**/api/v1/wardrobe/locations?*', (route) => {
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            request_id: id(99),
            error: { code: 'MAINTENANCE_MODE', message: '位置暂时无法读取' },
          },
        })
      const p = new URL(route.request().url()).searchParams
      const items = p.get('location_q')
        ? p.get('location_q') === '%_'
          ? [{ location: '衣柜%_&?', count: 2 }]
          : []
        : p.get('cursor')
          ? [{ location: long, count: 1 }]
          : [{ location: '衣柜', count: 25 }]
      return route.fulfill({
        json: envelope({
          items,
          next_cursor: p.get('location_q') || p.get('cursor') ? null : '衣柜',
          total_garments: 30,
          unassigned_count: 2,
          matching_locations: p.get('location_q') ? items.length : 2,
        }),
      })
    })
    await page.route('**/api/v1/garments?*', (route) =>
      route.fulfill({ json: envelope({ items: [careGarment(1)], next_cursor: null }) }),
    )
    await page.route('**/api/v1/wardrobe/care?*', (route) =>
      route.fulfill({ json: envelope({ items: [careGarment(1)], next_cursor: null }) }),
    )
    await page.goto('/wardrobe?category=top&season=winter&availability=unavailable')
    await expect(page.locator('.garment-card')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
    const dialog = page.getByRole('dialog', { name: '按收纳位置找衣服' })
    await expect(dialog.getByRole('button', { name: '全部位置 30 件' })).toBeVisible()
    await page.getByLabel('搜索已有位置').fill('%_')
    await page.getByRole('button', { name: '衣柜%_&? 2 件' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: '按收纳位置找衣服' })).toBeFocused()
    const params = new URL(page.url()).searchParams
    expect(params.get('location')).toBe('衣柜%_&?')
    expect(params.get('season')).toBe('winter')
    await page.reload()
    await expect(page.getByRole('button', { name: '移除筛选：位置：衣柜%_&?' })).toBeVisible()
    await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
    await page.getByRole('button', { name: '加载更多位置' }).click()
    const longButton = page.getByRole('button', { name: `${long} 1 件` })
    await expect(longButton).toBeVisible()
    const size = (await longButton.boundingBox())!
    expect(size.height).toBeGreaterThanOrEqual(44)
    await page.screenshot({ path: info.outputPath('locations-long.png'), animations: 'disabled' })
    await longButton.click()
    await expect(dialog).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    expect((await page.locator('.wardrobe-results').boundingBox())!.height).toBeGreaterThan(50)
    await page.screenshot({ path: info.outputPath('location-filter.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
    await expect(page.getByText(`当前选择：${long}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '未填写位置 2 件' }).click()
    await expect(dialog).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('location')).toBe(false)
    await page.getByRole('button', { name: '移除筛选：未填写位置' }).click()
    fail = true
    await page.getByRole('button', { name: '按收纳位置找衣服' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    fail = false
    await page.getByRole('button', { name: '重新读取位置' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.goto('/wardrobe/care?group=all')
    await page.getByRole('combobox', { name: '批量操作', exact: true }).selectOption('location_set')
    await page.getByLabel('新收纳位置').fill('未保存新位置')
    await page.getByRole('button', { name: '选择已有位置' }).click()
    await page.getByRole('button', { name: '衣柜 25 件' }).click()
    await expect(page.getByLabel('新收纳位置')).toHaveValue('衣柜')
    await expect(page.getByLabel('新收纳位置')).toBeFocused()
    await page.reload()
    await expect(page.getByLabel('新收纳位置')).toHaveValue('衣柜')
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
  })
}
