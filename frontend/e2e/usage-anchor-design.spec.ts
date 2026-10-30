import { expect, test } from '@playwright/test'
import { id, mockAudit, revision } from './content-audit-fixtures'

for (const [width, height] of [
  [320, 568],
  [1280, 900],
]) {
  test(`anchored outfit state, draft and explicit removal ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const audit = await mockAudit(page, revision())
    const envelope = (data: unknown) => ({ data, request_id: id(99) })
    await page.route('**/api/v1/profile/location', (route) =>
      route.fulfill({ json: envelope({ city: null, version: 1 }) }),
    )
    let state = 'available'
    await page.route(`**/api/v1/garments/${id(20)}`, (route) => {
      if (state === 'error') return route.abort()
      return route.fulfill({
        json: envelope({
          id: id(20),
          image_asset_id: id(30),
          version: 1,
          created_at: '2026-10-30T00:00:00Z',
          image_url: '/audit-assets/item.svg',
          has_cutout: false,
          is_demo: false,
          ownership: state === 'retired' ? 'retired' : 'owned',
          category: 'top',
          name: '浅蓝色棉质衬衫',
          color_codes: [],
          seasons: [],
          occasion_codes: [],
          style_codes: [],
          custom_tag_ids: [],
          material: null,
          thickness: null,
          warmth: null,
          availability: state === 'unavailable' ? 'unavailable' : 'available',
          display_variant: 'original',
        }),
      })
    })
    await page.goto(`/outfits/prepare?anchor=${id(20)}`)
    const anchor = page.getByRole('region', { name: '指定搭配单品' })
    await expect(anchor).toContainText('可穿 · 生成时保留这件')
    await expect(page.getByRole('heading', { name: '今天想怎么穿？' })).toBeVisible()
    await expect(page.getByRole('button', { name: '开始新的搭配' })).toHaveCount(0)
    await page.getByLabel('本次补充要求').fill('下雨天也要方便走路')
    await page.screenshot({ path: info.outputPath('anchor-ready.png'), fullPage: true })
    state = 'unavailable'
    await page.reload()
    await expect(anchor).toContainText('这件衣服暂不可穿')
    await expect(page.getByRole('link', { name: '回到列表处理' })).toHaveAttribute(
      'href',
      '/wardrobe/usage',
    )
    await expect(page.getByRole('button', { name: '生成搭配', exact: true })).toBeDisabled()
    await expect(page.getByLabel('本次补充要求')).toHaveValue('下雨天也要方便走路')
    await page.getByRole('link', { name: '查看单品状态', exact: true }).click()
    await expect(anchor).toBeFocused()
    const bounds = (await anchor.boundingBox())!
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeLessThan(height - 120)
    await page.screenshot({ path: info.outputPath('anchor-unavailable.png'), fullPage: true })
    state = 'retired'
    await page.reload()
    await expect(anchor).toContainText('这件衣服已退出衣橱')
    await expect(anchor).not.toContainText('这件衣服暂不可穿')
    state = 'error'
    await page.reload()
    await expect(page.getByRole('button', { name: '重新核对单品' })).toBeVisible({ timeout: 15000 })
    state = 'available'
    await page.getByRole('button', { name: '重新核对单品' }).click()
    await expect(anchor).toContainText('可穿 · 生成时保留这件')
    await page.addStyleTag({
      content:
        '.anchor-notice {font-size:20px} .anchor-notice p, .anchor-notice .button {font-size:20px}',
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '移除指定单品' }).click()
    await expect(anchor).toHaveCount(0)
    await expect(page.getByLabel('本次补充要求')).toHaveValue('下雨天也要方便走路')
    await expect(page).not.toHaveURL(/anchor=/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(audit.writes).toEqual([])
    expect(audit.errors).toEqual([])
  })
}
