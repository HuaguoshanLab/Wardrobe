import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'
import { careGarment as garment } from './care-fixtures'

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [844, 390],
  [1280, 900],
]) {
  test(`care selection, confirmation, errors and responsive layout ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const audit = await mockAudit(page, revision())
    let state = 'normal',
      long = false,
      epoch = ''
    const item = (n: number) => ({
      ...garment(n),
      ...(long && n === 1
        ? {
            name: '长名称'.repeat(30),
            lifecycle: { ...garment(n).lifecycle, location: '衣柜位置'.repeat(30) },
          }
        : {}),
    })
    await page.route('**/api/v1/capabilities', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      if (epoch) body.data.data_epoch = epoch
      await route.fulfill({ json: body })
    })
    await page.route('**/api/v1/wardrobe/care?*', async (route) => {
      if (state === 'error') return route.abort()
      const params = new URL(route.request().url()).searchParams
      const offset = params.get('cursor') ? 20 : 0
      return route.fulfill({
        json: {
          data: {
            items:
              state === 'empty' || params.get('q')
                ? []
                : Array.from({ length: offset ? 1 : 20 }, (_, n) => item(n + offset + 1)),
            next_cursor: state === 'empty' || params.get('q') || offset ? null : id(20),
          },
          request_id: id(99),
        },
      })
    })
    await page.route('**/api/v1/garments/*', (route) => {
      const n = Number(new URL(route.request().url()).pathname.split('/').at(-1)!.slice(-12))
      return route.fulfill({ json: { data: { ...item(n), version: 2 }, request_id: id(99) } })
    })
    await page.goto('/wardrobe')
    await expect(page.getByRole('heading', { name: '我的衣橱', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: info.outputPath('wardrobe-entry.png') })
    await page.getByRole('link', { name: '洗衣与批量管理', exact: true }).click()
    await page.getByRole('checkbox', { name: '选择：浅蓝色棉质衬衫', exact: true }).check()
    await expect(page.getByRole('button', { name: '只看已选（1）' })).toBeVisible()
    await page.getByRole('checkbox', { name: '选择：待洗单品 20', exact: true }).focus()
    const bar = page.getByRole('region', { name: '本次批量操作' })
    if (height > 500) {
      await expect(bar).toBeInViewport()
      const barBox = (await bar.boundingBox())!
      const itemBox = (await page
        .getByRole('checkbox', { name: '选择：待洗单品 20', exact: true })
        .boundingBox())!
      expect(itemBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height)
    }
    await page.screenshot({ path: info.outputPath('care-list.png') })
    await bar.getByRole('button', { name: '更改操作' }).click()
    await expect(page.getByRole('combobox', { name: '批量操作', exact: true })).toBeFocused()
    const editBox = (await page
      .getByRole('combobox', { name: '批量操作', exact: true })
      .boundingBox())!
    expect(editBox.y).toBeGreaterThanOrEqual(40)
    expect(editBox.y + editBox.height).toBeLessThan(height - (width <= 760 ? 80 : 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    for (const control of await page
      .locator('.care-groups button, .care-selection-bar button, .care-detail')
      .all()) {
      const b = (await control.boundingBox())!
      expect(b.width).toBeGreaterThanOrEqual(44)
      expect(b.height).toBeGreaterThanOrEqual(44)
    }
    await page.getByRole('button', { name: '加载更多单品' }).click()
    await page.getByRole('checkbox', { name: '选择：待洗单品 21', exact: true }).check()
    await page.getByLabel('搜索单品').fill('不存在')
    await expect(page.getByText('没有符合条件的单品')).toBeVisible()
    await page.getByRole('button', { name: '只看已选（2）' }).click()
    await expect(
      page.getByRole('checkbox', { name: '选择：待洗单品 21', exact: true }),
    ).toBeChecked()
    await page.reload()
    await expect(page.getByRole('button', { name: '只看已选（2）' })).toBeVisible()
    long = true
    await page.getByRole('button', { name: '核对并继续' }).click()
    const dialog = page.getByRole('dialog', { name: '核对本次批量操作' })
    await expect(dialog.getByText('长名称'.repeat(30), { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '确认对 2 件执行' })).toBeEnabled()
    await page.screenshot({
      path: info.outputPath('care-confirm-long.png'),
      animations: 'disabled',
    })
    await expect(dialog.getByRole('button', { name: '确认对 2 件执行' })).toBeInViewport()
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    const focus = await page.evaluate(
      () => document.activeElement?.closest('[role=dialog]') !== null,
    )
    expect(focus).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: '核对并继续' })).toBeFocused()
    await page.addStyleTag({
      content: '.care-page {font-size:20px} .care-page p,.care-page strong {font-size:20px}',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.getByRole('button', { name: '清空选择' }).click()
    await page.getByLabel('搜索单品').fill('')
    state = 'empty'
    await page.reload()
    await expect(page.getByText('暂无待洗单品')).toBeVisible()
    state = 'error'
    await page.reload()
    await expect(page.getByRole('button', { name: '重新读取清单' })).toBeVisible({ timeout: 15000 })
    state = 'normal'
    long = false
    await page.getByRole('button', { name: '重新读取清单' }).click()
    await page.getByRole('checkbox', { name: '选择：浅蓝色棉质衬衫', exact: true }).check()
    await page.getByRole('button', { name: '核对并继续' }).click()
    // Abort locally: no mutation is allowed to reach the underlying application.
    await page.getByRole('button', { name: '确认对 1 件执行' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(audit.writes).toHaveLength(1)
    await page.reload()
    await expect(page.getByRole('button', { name: '重发原批量请求' })).toBeVisible()
    expect(audit.writes).toHaveLength(1)
    epoch = id(88)
    await page.reload()
    await expect(page.getByRole('button', { name: '只看已选（0）' })).toBeVisible()
    await expect(page.getByRole('button', { name: '重发原批量请求' })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('wardrobe.care.pending'))).toBeNull()
    expect(audit.writes).toHaveLength(1)
    expect(audit.errors).toEqual([])
  })
}
