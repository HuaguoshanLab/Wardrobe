import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`usage totals, independent filters and narrow layout ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const audit = await mockAudit(page, revision())
    let state = 'normal'
    let longName = false
    let hold: Promise<void> | null = null
    await page.route('**/api/v1/wardrobe/usage?*', async (route) => {
      if (hold) await hold
      const url = new URL(route.request().url())
      const range = url.searchParams.get('range')
      const view = url.searchParams.get('view')
      const offset = Number(url.searchParams.get('offset'))
      if (state === 'error') return route.abort()
      return route.fulfill({
        json: {
          data: {
            range,
            view,
            as_of: '2026-10-30',
            window_start: state === 'empty' ? null : '2026-10-01',
            timezone: 'Asia/Shanghai',
            total_garments: state === 'empty' ? 0 : 500,
            recorded_garments: state === 'empty' ? 0 : 50,
            unrecorded_garments: state === 'empty' ? 0 : 450,
            recorded_ratio: state === 'empty' ? null : 0.1,
            total_items: state === 'empty' ? 0 : 50,
            offset,
            limit: 20,
            next_offset: state === 'empty' || offset ? null : 20,
            items:
              state === 'empty'
                ? []
                : [
                    {
                      garment_id: id(20),
                      name: longName ? '长名称'.repeat(30) : '浅蓝色棉质衬衫',
                      category: 'top',
                      image_url: '/audit-assets/item.svg',
                      availability: 'available',
                      created_at: '2026-10-29T00:00:00Z',
                      wear_days: view === 'worn' ? 5 : 0,
                      last_worn_on: '2026-09-01',
                    },
                    {
                      garment_id: id(21),
                      name: '暂不可穿的单品',
                      category: 'top',
                      image_url: '/audit-assets/missing.png',
                      availability: 'unavailable',
                      created_at: '2026-10-29T00:00:00Z',
                      wear_days: view === 'worn' ? 2 : 0,
                      last_worn_on: null,
                    },
                  ],
          },
          request_id: id(99),
        },
      })
    })
    await page.goto('/wardrobe')
    await page.getByRole('link', { name: '利用情况', exact: true }).click()
    await expect(page.getByText('50 / 500 件当前衣服')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    for (const control of await page
      .locator('.usage-ranges button, .usage-view, .usage-item-actions a')
      .all()) {
      const box = (await control.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: info.outputPath('usage.png'), fullPage: true })
    longName = true
    await page.reload()
    await expect(page.locator('.usage-card').first()).toContainText('长名称'.repeat(30))
    await page.screenshot({ path: info.outputPath('usage-long-name.png'), fullPage: true })
    await page.getByRole('button', { name: '下一页' }).click()
    await expect(page).toHaveURL(/offset=20/)
    await expect(page.getByRole('heading', { name: '常穿单品', exact: true })).toBeFocused()
    let release!: () => void
    hold = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.getByRole('button', { name: '近 90 天' }).click()
    await expect(page).not.toHaveURL(/offset=/)
    await expect(page.getByRole('status')).toContainText('正在读取所选范围')
    await expect(page.getByRole('button', { name: '近 90 天' })).toBeFocused()
    await expect(page.getByRole('button', { name: '期间无记录 · 正在读取' })).toBeVisible()
    release()
    hold = null
    await page.getByRole('button', { name: '期间无记录 · 450' }).click()
    await expect(page.locator('.usage-card').first()).toContainText('期间无记录')
    await page.reload()
    await expect(page.getByRole('button', { name: '近 90 天' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('link', { name: '围绕这件搭配' }).focus()
    const bounds = (await page.getByRole('link', { name: '围绕这件搭配' }).boundingBox())!
    if (width <= 760)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(
        (await page.locator('.sidebar').boundingBox())!.y,
      )
    await page.addStyleTag({
      content: '.usage-page {font-size:20px} .usage-page p,.usage-page h3{font-size:20px}',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    state = 'empty'
    await page.reload()
    await expect(page.getByText('先把衣服放进衣橱')).toBeVisible()
    state = 'error'
    await page.reload()
    await expect(page.getByRole('button', { name: '重新读取利用情况' })).toBeVisible({
      timeout: 15000,
    })
    state = 'normal'
    await page.getByRole('button', { name: '重新读取利用情况' }).click()
    await expect(page.getByText('50 / 500 件当前衣服')).toBeVisible()
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
  })
}
